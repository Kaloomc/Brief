// Données de l'appli : fichiers JSON dans data/ (ignoré par Git) et cache de ce qu'on lit dans Notion.
//  - la liste des briefs : une requête Notion, gardée 15 minutes (en mémoire et dans data/liste.json, pour démarrer sans réseau) ;
//  - le texte d'un brief : lu une seule fois (data/textes/AAAA-MM-JJ.json). Un brief passé ne change plus ;
//    celui d'aujourd'hui est relu seulement si son nombre de mots a changé ;
//  - la progression d'écoute et les réglages.
const fs = require('fs');
const path = require('path');
const { parisDe, ajouterJours } = require('./temps');
const { analyser } = require('./parseur');

const DUREE_CACHE = 15 * 60e3;
const JOURS_AUDIO = 30;

function creer({ dossier, notion, maintenant = () => new Date() }) {
  const chemin = (...p) => path.join(dossier, ...p);

  function lire(nom) {
    try {
      return JSON.parse(fs.readFileSync(chemin(nom), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
  function ecrire(nom, valeur) {
    const f = chemin(nom);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + '.tmp', JSON.stringify(valeur, null, 1));
    fs.renameSync(f + '.tmp', f); // remplacement d'un coup : jamais de fichier à moitié écrit
  }
  const lireSur = (nom, defaut) => {
    try {
      return lire(nom) ?? defaut;
    } catch {
      return defaut; // fichier abîmé : on repart de zéro plutôt que de planter
    }
  };

  // --- Liste des briefs ---------------------------------------------------------------------------
  let liste = lireSur('liste.json', null); // { quand, briefs: [...] }
  let enCours = null;

  // Un brief par jour (si la tâche a créé deux pages le même jour, la plus récemment modifiée gagne), le plus récent d'abord.
  function normaliser(briefs) {
    const parDate = new Map();
    for (const b of briefs) {
      const date = b.date || (b.cree ? parisDe(new Date(b.cree)).date : null);
      if (!date) continue;
      const courant = parDate.get(date);
      if (!courant || (b.modifie || '') > (courant.modifie || '')) parDate.set(date, { ...b, date });
    }
    return [...parDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  // { briefs, quand, perime } — `perime` : Notion n'a pas répondu, on montre la dernière liste connue.
  async function listerBriefs({ force = false } = {}) {
    const frais = liste && maintenant().getTime() - liste.quand < DUREE_CACHE;
    if (frais && !force) return { briefs: liste.briefs, quand: liste.quand, perime: false };
    enCours ??= notion.listerBriefs()
      .then((b) => {
        liste = { quand: maintenant().getTime(), briefs: normaliser(b) };
        ecrire('liste.json', liste);
        return liste;
      })
      .finally(() => { enCours = null; });
    try {
      const l = await enCours;
      return { briefs: l.briefs, quand: l.quand, perime: false };
    } catch (err) {
      if (!liste) throw err;
      return { briefs: liste.briefs, quand: liste.quand, perime: true, erreur: err.message };
    }
  }
  // Lecture du cache seulement (widget) : jamais d'appel à Notion.
  const listeEnCache = () => liste?.briefs ?? null;

  // Met à jour un brief de la liste en mémoire après une écriture dans Notion (sans relire Notion).
  function majBrief(id, patch) {
    if (!liste) return;
    const b = liste.briefs.find((x) => x.id === id);
    if (b) Object.assign(b, patch);
    ecrire('liste.json', liste);
  }

  // --- Texte d'un brief ---------------------------------------------------------------------------
  // { chapitres, mots } pour un brief de la liste. `force` : relire Notion même si le cache semble bon.
  async function texte(brief, { force = false } = {}) {
    const f = `textes/${brief.date}.json`;
    const cache = lireSur(f, null);
    const aujourdhui = parisDe(maintenant()).date;
    const memeMots = cache && (cache.motsNotion === brief.mots || brief.mots == null || cache.motsNotion == null);
    // Brief passé : il ne change plus (relu seulement si son nombre de mots a changé). Celui d'aujourd'hui : relu au plus une fois par heure.
    const recent = cache && maintenant().getTime() - Date.parse(cache.recupere) < 3600e3;
    const utilisable = cache && cache.id === brief.id && memeMots && (brief.date < aujourdhui || recent);
    // (un brief passé dont le nombre de mots a changé est relu : la tâche l'a réécrit)
    if (utilisable && !force) return cache;
    const analyse = analyser(await notion.lireCorps(brief.id));
    const r = { id: brief.id, date: brief.date, titre: brief.titre, motsNotion: brief.mots, modifie: brief.modifie, recupere: maintenant().toISOString(), ...analyse };
    ecrire(f, r);
    return r;
  }
  const texteEnCache = (date) => lireSur(`textes/${date}.json`, null);

  // Recherche dans les textes déjà lus (les briefs dont l'audio a été fabriqué, ou qu'on a ouverts).
  const sans = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  function texteContient(date, mot) {
    const t = texteEnCache(date);
    return !!t && sans(t.chapitres.map((c) => `${c.titre} ${c.texte}`).join(' ')).includes(mot);
  }

  // --- Progression d'écoute -----------------------------------------------------------------------
  // { 'AAAA-MM-JJ': { position, duree, ecoute, maj } }
  const progression = () => lireSur('progression.json', {});
  function enregistrerProgression(date, { position, duree, ecoute, maj }) {
    const tout = progression();
    const avant = tout[date];
    // Le plus récent gagne (le téléphone et le serveur peuvent être décalés : on compare les dates d'enregistrement).
    if (avant && maj && avant.maj && maj < avant.maj) return avant;
    tout[date] = { position, duree, ecoute: !!(ecoute || avant?.ecoute), maj: maj || maintenant().getTime() };
    // On ne garde que 400 jours de progression.
    const limite = ajouterJours(parisDe(maintenant()).date, -400);
    for (const d of Object.keys(tout)) if (d < limite) delete tout[d];
    ecrire('progression.json', tout);
    return tout[date];
  }

  // --- Réglages -----------------------------------------------------------------------------------
  const VITESSES = [1, 1.25, 1.5, 2];
  const REGLAGES_DEFAUT = { vitesse: 1, rappel: null }; // rappel : « 07:00 » (heure de Paris) ou null
  const reglages = () => ({ ...REGLAGES_DEFAUT, ...lireSur('reglages.json', {}) });
  function enregistrerReglages(r) {
    const nouveau = { ...reglages() };
    if (r.vitesse !== undefined) {
      if (!VITESSES.includes(Number(r.vitesse))) throw Object.assign(new Error('Vitesse inconnue (1, 1,25, 1,5 ou 2).'), { status: 400 });
      nouveau.vitesse = Number(r.vitesse);
    }
    if (r.rappel !== undefined) {
      if (r.rappel !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.rappel)) throw Object.assign(new Error('Heure du rappel invalide (HH:MM).'), { status: 400 });
      nouveau.rappel = r.rappel;
    }
    ecrire('reglages.json', nouveau);
    return nouveau;
  }

  return {
    chemin, lire, ecrire, lireSur, listerBriefs, listeEnCache, majBrief, texte, texteEnCache, texteContient, sans,
    progression, enregistrerProgression, reglages, enregistrerReglages, JOURS_AUDIO, VITESSES,
  };
}

module.exports = { creer, JOURS_AUDIO };
