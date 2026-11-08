// Fabrication de l'audio : repère les pages « Script prêt », lit la voix, range le MP3 et son manifest dans data/audio,
// puis écrit dans Notion « Audio (URL) » et « Statut » = « Audio prêt » (et rien d'autre).
//
// Règles :
//  - une page dont le statut est « Script prêt » et qui n'a pas d'audio est traitée ;
//  - une page qui a déjà son audio n'est pas retraitée, sauf si son nombre de mots a changé (le script a été réécrit) ;
//  - si la voix échoue : deux nouvelles tentatives, puis le texte reste lisible avec un message clair ;
//    le statut n'est JAMAIS mis à « Erreur » (réservé à la tâche Claude) ;
//  - les fichiers audio sont gardés 30 jours.
const fs = require('fs');
const path = require('path');
const { pourLaVoix, compterMots } = require('./nettoyage');
const { parisDe, ajouterJours, dateValide } = require('./temps');
const { JOURS_AUDIO } = require('./donnees');

const ATTENTES = [30e3, 120e3]; // avant les 2 nouvelles tentatives

function creerAudio({ donnees, notion, voix, urlPublique, journal = console.log, maintenant = () => new Date(), attentes = ATTENTES, moteur }) {
  const dossierAudio = donnees.chemin('audio');
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const fichier = (date, ext) => path.join(dossierAudio, `${date}.${ext}`);
  const urlAudio = (date) => `${urlPublique.replace(/\/+$/, '')}/audio/${date}.mp3`;

  // Manifest d'un audio prêt (le MP3 et le manifest doivent exister tous les deux).
  function manifest(date) {
    if (!dateValide(date) || !fs.existsSync(fichier(date, 'mp3'))) return null;
    try {
      return JSON.parse(fs.readFileSync(fichier(date, 'json'), 'utf8'));
    } catch {
      return null;
    }
  }

  // Échecs gardés dans data/audio-etat.json : { date: { mots, tentatives, abandon, message, quand } }
  const echecs = () => donnees.lireSur('audio-etat.json', {});
  const noterEchec = (date, valeur) => {
    const tout = echecs();
    if (valeur) tout[date] = valeur;
    else delete tout[date];
    donnees.ecrire('audio-etat.json', tout);
  };
  // Au démarrage, on redonne sa chance aux briefs abandonnés (la voix a pu être réparée entre-temps).
  function oublierAbandons() {
    const tout = echecs();
    for (const d of Object.keys(tout)) tout[d].abandon = false, tout[d].tentatives = 0;
    donnees.ecrire('audio-etat.json', tout);
  }

  // Ce que l'appli en cours fait, pour l'écran « Audio en préparation ».
  const travail = { date: null, chapitre: 0, total: 0 };

  // 'generer' | 'ecrire' (audio fait, Notion pas encore à jour) | null
  function besoin(brief) {
    if (brief.statut !== notion.STATUT_SCRIPT) return null;
    if (brief.date < ajouterJours(parisDe(maintenant()).date, -JOURS_AUDIO)) return null; // l'audio serait supprimé aussitôt
    const m = manifest(brief.date);
    const abandon = echecs()[brief.date];
    if (m) {
      if (brief.mots != null && m.mots != null && m.mots !== brief.mots) {
        return abandon?.abandon && abandon.mots === brief.mots ? null : 'generer'; // script réécrit
      }
      return 'ecrire';
    }
    if (abandon?.abandon && abandon.mots === brief.mots) return null;
    return 'generer';
  }

  async function ecrireNotion(brief, m) {
    // Vérification juste avant d'écrire : le script a pu être réécrit pendant la fabrication.
    const actuelle = await notion.lirePage(brief.id);
    if (actuelle.statut !== notion.STATUT_SCRIPT) {
      journal(`${brief.date} : le statut n'est plus « Script prêt » (${actuelle.statut}), rien n'est écrit dans Notion.`);
      return false;
    }
    if (actuelle.mots != null && m.mots != null && actuelle.mots !== m.mots) {
      journal(`${brief.date} : le script a changé pendant la fabrication (${m.mots} → ${actuelle.mots} mots), il sera refait.`);
      return false;
    }
    const maj = await notion.marquerAudioPret(brief.id, urlAudio(brief.date));
    donnees.majBrief(brief.id, { statut: maj.statut, audioUrl: maj.audioUrl, modifie: maj.modifie });
    return true;
  }

  async function fabriquer(brief) {
    const t = await donnees.texte(brief, { force: true });
    // Ne lire que le texte parlé (sources, Markdown, adresses, émojis retirés).
    const chapitres = t.chapitres.map((c) => ({ titre: c.titre, voix: pourLaVoix(c.texte) })).filter((c) => c.voix);
    if (!chapitres.length) {
      noterEchec(brief.date, { mots: brief.mots, tentatives: 0, abandon: true, message: 'Le brief ne contient aucun texte à lire.', quand: maintenant().toISOString() });
      journal(`${brief.date} : aucun texte à lire.`);
      return null;
    }
    const mots = brief.mots ?? t.mots ?? chapitres.reduce((n, c) => n + compterMots(c.voix), 0);
    let derniere;
    for (let essai = 0; essai <= attentes.length; essai++) {
      if (essai > 0) await pause(attentes[essai - 1]);
      noterEchec(brief.date, { mots, tentatives: essai, abandon: false, message: derniere?.message || null, quand: maintenant().toISOString() });
      Object.assign(travail, { date: brief.date, chapitre: 0, total: chapitres.length });
      try {
        const m = await voix.fabriquer({
          date: brief.date, chapitres, dossierAudio, moteur,
          meta: { titre: brief.titre, mots, pageId: brief.id },
          progression: (i, n) => Object.assign(travail, { chapitre: i, total: n }),
        });
        noterEchec(brief.date, null);
        journal(`${brief.date} : audio prêt (${Math.round(m.duree)} s, ${m.chapitres.length} chapitres).`);
        return m;
      } catch (err) {
        derniere = err;
        journal(`${brief.date} : la voix a échoué (essai ${essai + 1}/${attentes.length + 1}) : ${err.message}`);
      }
    }
    noterEchec(brief.date, {
      mots, tentatives: attentes.length + 1, abandon: true, quand: maintenant().toISOString(),
      message: `La voix n'a pas pu fabriquer l'audio (${derniere.message}).`,
    });
    return null;
  }

  async function traiter(brief, quoi) {
    let m = quoi === 'ecrire' ? manifest(brief.date) : await fabriquer(brief);
    if (!m) return false;
    try {
      await ecrireNotion(brief, m);
    } catch (err) {
      // L'audio est bien là et lisible dans l'appli ; Notion sera mis à jour à la prochaine vérification.
      journal(`${brief.date} : écriture dans Notion impossible : ${err.message}`);
    }
    return true;
  }

  // Une seule fabrication à la fois (la voix occupe le processeur du NAS) : les tâches font la queue.
  let file = Promise.resolve();
  const enfiler = (tache) => {
    const p = file.then(tache);
    file = p.catch(() => {});
    return p;
  };

  // Une vérification : à lancer toutes les 10 minutes le matin, puis toutes les heures. Deux demandes en même temps n'en font qu'une.
  let verification = null;
  function verifier() {
    verification ??= enfiler(async () => {
      try {
        nettoyer();
        const { briefs } = await donnees.listerBriefs({ force: true });
        const fait = [];
        for (const b of briefs) { // le plus récent d'abord
          const quoi = besoin(b);
          if (!quoi) continue;
          await traiter(b, quoi);
          fait.push(b.date);
        }
        return fait;
      } catch (err) {
        journal(`Vérification des briefs impossible : ${err.message}`);
        return [];
      } finally {
        travail.date = null;
        verification = null;
      }
    });
    return verification;
  }

  // « Réessayer l'audio » depuis l'appli : redonne sa chance à un brief dont la voix a échoué.
  async function relancer(date) {
    if (!dateValide(date)) throw Object.assign(new Error('Date invalide.'), { status: 400 });
    const { briefs } = await donnees.listerBriefs();
    const b = briefs.find((x) => x.date === date);
    if (!b) throw Object.assign(new Error('Brief introuvable.'), { status: 404 });
    // Statut « Audio prêt » mais fichiers perdus : on refait l'audio sans toucher à Notion.
    const sansNotion = b.statut === notion.STATUT_AUDIO;
    if (sansNotion ? manifest(date) : b.statut !== notion.STATUT_SCRIPT) {
      throw Object.assign(new Error(`Ce brief n'attend pas d'audio (statut : ${b.statut || 'aucun'}).`), { status: 409 });
    }
    const tout = echecs();
    delete tout[date];
    donnees.ecrire('audio-etat.json', tout);
    enfiler(async () => {
      try {
        if (sansNotion) await fabriquer(b);
        else await traiter(b, 'generer');
      } catch (err) {
        journal(`${date} : ${err.message}`);
      } finally {
        travail.date = null;
      }
    });
    return { ok: true };
  }

  // Conservation : les fichiers audio de plus de 30 jours sont supprimés (le texte reste dans Notion).
  function nettoyer() {
    const limite = ajouterJours(parisDe(maintenant()).date, -JOURS_AUDIO);
    let supprimes = 0;
    let noms = [];
    try {
      noms = fs.readdirSync(dossierAudio);
    } catch {
      return 0;
    }
    for (const nom of noms) {
      const m = /^(\d{4}-\d{2}-\d{2})\.(mp3|json)$/.exec(nom);
      if (m && m[1] < limite) {
        fs.rmSync(path.join(dossierAudio, nom), { force: true });
        supprimes++;
      } else if (nom.startsWith('.') && Date.now() - fs.statSync(path.join(dossierAudio, nom)).mtimeMs > 6 * 3600e3) {
        fs.rmSync(path.join(dossierAudio, nom), { recursive: true, force: true }); // dossier de travail oublié par un arrêt brutal
      }
    }
    return supprimes;
  }

  // État d'un brief pour l'écran : audio prêt, en cours, ou échec.
  function etatDe(date) {
    if (manifest(date)) return { etat: 'pret' };
    if (travail.date === date) return { etat: 'enCours', chapitre: travail.chapitre, total: travail.total };
    const e = echecs()[date];
    if (e?.abandon) return { etat: 'echec', message: e.message };
    if (e?.tentatives) return { etat: 'enCours', chapitre: 0, total: 0, nouvelEssai: true };
    return { etat: 'attente' };
  }

  return { besoin, manifest, verifier, relancer, nettoyer, etatDe, oublierAbandons, urlAudio, fichier, dossierAudio, travail };
}

module.exports = { creerAudio };
