'use strict';
// Brief : lecteur du podcast du matin. HTML, CSS et JS simples, aucune compilation.
// Sécurité : tout ce qui vient d'un brief (titres, textes, sources) est inséré avec textContent, jamais comme du HTML.
const $ = (s, r = document) => r.querySelector(s);
const audio = $('#audio');

// Constructeur DOM sûr : h('p', { class: 'x' }, 'texte', autreNoeud)
function h(tag, props, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'texte') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat()) if (e != null) el.append(e);
  return el;
}
const vider = (el) => el.replaceChildren();

// Icône du jeu de symboles du index.html (jamais d'émoji) : icone('check') → <svg><use href="#i-check"/></svg>
const SVG = 'http://www.w3.org/2000/svg';
function icone(nom) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${nom}`);
  svg.append(use);
  return svg;
}

// --- Réseau ---------------------------------------------------------------------------------------
async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method, credentials: 'same-origin', keepalive: method !== 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/connexion')) {
    location.hash = '#connexion';
    throw new Error('Connexion nécessaire');
  }
  if (!res.ok) throw new Error(data.erreur || `Erreur ${res.status}`);
  return data;
}

// --- Petits outils --------------------------------------------------------------------------------
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateLongue = (d) => { const x = new Date(d + 'T12:00:00Z'); return `${JOURS[x.getUTCDay()]} ${x.getUTCDate()} ${MOIS_LONGS[x.getUTCMonth()]}`; };
const dateCourte = (d) => { const x = new Date(d + 'T12:00:00Z'); return `${JOURS[x.getUTCDay()].slice(0, 3)}. ${x.getUTCDate()} ${MOIS[x.getUTCMonth()]}`; };
const temps = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const minutes = (m) => (m == null ? '' : `${String(m).replace('.', ',')} min`);
const vitesseTexte = (v) => `${String(v).replace('.', ',')}×`;
const VITESSES = [1, 1.25, 1.5, 2];
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible : tant pis */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* idem */ } };
const urlSure = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; } };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// --- État -----------------------------------------------------------------------------------------
let reglages = { vitesse: Number(lsGet('brief:vitesse')) || 1, rappel: null };
let brief = null;          // détail du brief affiché (réponse de /api/briefs/:date)
let enCours = null;        // date du brief chargé dans l'élément audio
let suivre = true;         // l'écran suit le chapitre en cours
let chapitreCourant = -1;
let ecouteEnvoyee = false;
let aJoue = false;        // la lecture a démarré pour ce brief (sinon on ne touche pas à la position enregistrée)
let minuteurAttente = null;

// --- Navigation -----------------------------------------------------------------------------------
function route() {
  const h_ = location.hash.replace(/^#/, '') || 'aujourdhui';
  const m = /^brief\/(\d{4}-\d{2}-\d{2})$/.exec(h_);
  if (m) return { nom: 'lecteur', date: m[1], onglet: 'archives' };
  if (h_ === 'aujourdhui') return { nom: 'lecteur', date: null, onglet: 'aujourdhui' };
  if (['archives', 'reglages', 'connexion'].includes(h_)) return { nom: h_, onglet: h_ };
  return { nom: 'lecteur', date: null, onglet: 'aujourdhui' };
}

let premiereVue = true;
async function afficher() {
  clearTimeout(minuteurAttente);
  const r = route();
  for (const s of document.querySelectorAll('main > section')) s.classList.toggle('active', s.id === r.nom);
  for (const a of document.querySelectorAll('nav a')) {
    a.classList.toggle('actif', a.dataset.onglet === r.onglet);
    if (a.dataset.onglet === r.onglet) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.querySelector('nav').hidden = r.nom === 'connexion';
  const titre = { lecteur: r.date ? 'Brief' : 'Aujourd’hui', archives: 'Archives', reglages: 'Réglages', connexion: 'Brief' }[r.nom];
  $('#titre-ecran').textContent = titre;
  document.title = r.nom === 'connexion' || titre === 'Brief' ? 'Brief' : `${titre} · Brief`;
  $('#retour-archives').hidden = !r.date;
  majMini();
  window.scrollTo(0, 0);
  if (!premiereVue) $('#titre-ecran').focus({ preventScroll: true }); // les lecteurs d'écran annoncent le nouvel écran
  premiereVue = false;
  if (r.nom === 'lecteur') chargement(true);
  try {
    if (r.nom === 'lecteur') await ouvrirLecteur(r.date);
    else if (r.nom === 'archives') await ouvrirArchives();
    else if (r.nom === 'reglages') await ouvrirReglages();
  } catch (err) {
    if (err.message !== 'Connexion nécessaire') {
      const hors = !navigator.onLine;
      montrerEtat(hors ? 'Pas de réseau' : 'Impossible de charger', `${err.message}. Le dernier brief déjà ouvert reste lisible hors ligne.`, { erreur: true, bouton: 'Réessayer', action: afficher, icone: 'alert' });
      if (r.nom === 'archives') $('#archives-etat').hidden = true;
    }
  } finally {
    chargement(false);
  }
}
window.addEventListener('hashchange', afficher);
window.addEventListener('online', () => { if (route().nom === 'lecteur' && !$('#etat-brief').hidden) afficher(); });

// --- Écran « lecteur » ----------------------------------------------------------------------------
// Squelette pendant le chargement du lecteur (jamais un écran vide).
function chargement(actif) {
  const sq = $('#squelette');
  sq.hidden = !(actif && $('#carte-lecteur').hidden);
}

function montrerEtat(titre, texte, { bouton, action, erreur, icone: ic } = {}) {
  $('#carte-lecteur').hidden = true;
  $('#squelette').hidden = true;
  vider($('#textes'));
  const e = $('#etat-brief');
  $('#etat-icone').setAttribute('href', `#i-${ic || (erreur ? 'alert' : 'sunrise')}`);
  e.hidden = false;
  e.classList.toggle('erreur', !!erreur);
  $('#etat-titre').textContent = titre;
  $('#etat-texte').textContent = texte;
  const b = $('#etat-bouton');
  b.hidden = !bouton;
  if (bouton) { b.textContent = bouton; b.onclick = action; }
}

async function ouvrirLecteur(dateDemandee) {
  const liste = await api('/api/briefs');
  const jour = liste.maintenant;
  const date = dateDemandee || liste.briefs.find((b) => b.date === jour.date)?.date;
  if (!date) {
    // Rien pour aujourd'hui : « Le brief arrive » avant 10 h, « Brief indisponible » ensuite.
    const dernier = liste.briefs[0];
    const minutesJour = jour.heure * 60 + jour.minute;
    const lien = dernier ? { bouton: `Écouter le dernier brief (${dateCourte(dernier.date)})`, action: () => { location.hash = `#brief/${dernier.date}`; } } : {};
    if (minutesJour < 10 * 60) {
      montrerEtat('Le brief arrive', minutesJour < 6 * 60 + 30 ? 'Ton brief du matin sera prêt vers 6 h 30.' : 'Il est en cours d’écriture, il apparaîtra ici tout seul.', lien);
      minuteurAttente = setTimeout(afficher, 2 * 60e3);
    } else {
      montrerEtat('Brief indisponible', 'Aucun brief n’est prêt ce matin. Vérifie la tâche « Brief du matin » dans Notion.', { ...lien, erreur: true });
    }
    return;
  }
  await chargerBrief(date);
}

async function chargerBrief(date) {
  const d = await api(`/api/briefs/${date}`);
  if (route().date !== (location.hash.startsWith('#brief/') ? date : null) && location.hash.startsWith('#brief/')) return; // on est déjà ailleurs
  brief = d;
  $('#etat-brief').hidden = true;
  $('#carte-lecteur').hidden = false;
  dessinerBrief();
  preparerAudio();
  // Tant que l'audio se prépare, on revient voir toutes les 30 secondes (le texte est déjà lisible).
  const attente = !d.audio && !d.audioExpire && d.generation.etat !== 'echec' && d.statut !== 'Erreur';
  if (attente && route().nom === 'lecteur') minuteurAttente = setTimeout(() => chargerBrief(date).catch(() => {}), 30e3);
}

function avis(texte, { erreur, bouton, action } = {}) {
  const a = $('#brief-avis');
  a.hidden = !texte;
  a.classList.toggle('erreur', !!erreur);
  vider(a);
  if (!texte) return;
  a.append(texte);
  if (bouton) a.append(h('br'), Object.assign(h('button', { type: 'button', class: 'secondaire' }, bouton), { onclick: action }));
}

function dessinerBrief() {
  const b = brief;
  $('#brief-date').textContent = dateLongue(b.date);
  $('#brief-titre').textContent = b.titre;
  const nb = b.chapitres.length;
  const infos = $('#brief-infos');
  vider(infos);
  if (b.dureeMin != null) infos.append(h('span', { class: 'puce' }, icone('clock'), minutes(b.dureeMin)));
  if (nb) infos.append(h('span', { class: 'puce' }, icone(b.audio ? 'headphones' : 'file'), `${nb} chapitre${nb > 1 ? 's' : ''}`));
  if (b.perime) infos.append(h('span', { class: 'puce' }, icone('alert'), 'liste non actualisée'));

  // Messages d'état (le texte reste toujours lisible en dessous)
  const nonPret = !b.audio;
  if (b.statut === 'Erreur') avis('Le brief n’a pas pu être écrit en entier ce matin (statut « Erreur » dans Notion). Le texte ci-dessous peut être incomplet.', { erreur: true });
  else if (b.texteIndisponible) avis(b.texteIndisponible, { erreur: true });
  else if (!nonPret) avis(null);
  else if (b.audioExpire) avis('L’audio de ce brief n’est plus conservé (30 jours). Le texte et les sources restent disponibles.');
  else if (b.generation.etat === 'echec') avis(`Audio indisponible : ${b.generation.message || 'la voix a échoué.'} Le texte est lisible ci-dessous.`, { erreur: true, bouton: 'Réessayer l’audio', action: reessayer });
  else if (b.generation.etat === 'enCours') avis(`Audio en préparation${b.generation.total ? ` (chapitre ${Math.min(b.generation.chapitre + 1, b.generation.total)} sur ${b.generation.total})` : ''}… Le texte est déjà lisible.`);
  else if (b.statut === 'Audio prêt') avis('L’audio n’est plus sur le serveur. Le texte reste lisible.', { bouton: 'Refaire l’audio', action: reessayer });
  else avis('Audio en préparation : il sera prêt dans quelques minutes. Le texte est déjà lisible.');

  $('#commandes').hidden = nonPret;
  $('#voix-iphone').hidden = !nonPret || b.audioExpire || !('speechSynthesis' in window) || !b.chapitres.some((c) => c.voix);
  $('#liste-chapitres').hidden = false;
  $('#temps-total').textContent = temps(b.audioInfo?.duree);

  // Chapitres (liste cliquable) et textes
  const ol = $('#liste-chapitres');
  vider(ol);
  b.chapitres.forEach((c, i) => {
    const nom = h('span', { class: 'nom', texte: c.titre });
    const num = h('span', { class: 'num' }, h('span', { class: 'txt', texte: String(i + 1) }), h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
    const contenu = [num, nom, c.audio ? h('span', { class: 'duree', texte: temps(c.audio.duree) }) : null];
    const bouton = h('button', { type: 'button', 'data-i': i, 'aria-label': `Chapitre ${i + 1} : ${c.titre}` }, contenu);
    if (c.audio) bouton.addEventListener('click', () => sauterAuChapitre(i));
    else bouton.addEventListener('click', () => $(`#chapitre-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    ol.append(h('li', { 'data-i': i }, bouton));
  });

  const zone = $('#textes');
  vider(zone);
  b.chapitres.forEach((c, i) => {
    const art = h('article', { class: 'chapitre', id: `chapitre-${i}`, 'data-i': i }, h('h3', { texte: c.titre }));
    (c.texte || '').split(/\n{2,}/).filter(Boolean).forEach((p) => art.append(h('p', { texte: p })));
    if (c.sources.length) {
      const ul = h('ul', { class: 'sources' }, h('h4', { texte: 'Sources' }));
      for (const s of c.sources) {
        const url = s.url && urlSure(s.url);
        const monogramme = h('span', { class: 'mono', 'aria-hidden': 'true', texte: ([...(s.site || s.titre)][0] || '?') });
        const corps = h('span', { class: 'corps' }, h('span', { class: 'titre', texte: s.titre }), s.site ? h('span', { class: 'site', texte: s.site }) : null);
        // Un appui ouvre la source dans un nouvel onglet, sans rien transmettre à la page ouverte.
        ul.append(h('li', {}, url
          ? h('a', { class: 'source', href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${s.titre}${s.site ? `, ${s.site}` : ''} (s’ouvre dans un nouvel onglet)` }, monogramme, corps, icone('external'))
          : h('span', { class: 'source' }, monogramme, corps)));
      }
      art.append(ul);
    }
    zone.append(art);
  });
  chapitreCourant = -1;
  surbrillance();
  majBoutons();
}

async function reessayer() {
  try {
    await api(`/api/briefs/${brief.date}/audio`, { method: 'POST' });
    avis('Nouvelle tentative lancée… Le texte reste lisible.');
    minuteurAttente = setTimeout(() => chargerBrief(brief.date).catch(() => {}), 5e3);
  } catch (err) {
    avis(err.message, { erreur: true });
  }
}

// --- Lecteur audio --------------------------------------------------------------------------------
const cleLocale = (d) => `brief:pos:${d}`;
function positionLocale(d) { try { return JSON.parse(lsGet(cleLocale(d))) || null; } catch { return null; } }

function preparerAudio() {
  const info = brief.audioInfo;
  if (!info) {
    if (enCours === brief.date) { audio.pause(); }
    return;
  }
  if (enCours === brief.date) return majBoutons(); // déjà chargé : on ne coupe pas la lecture
  if (enCours) { sauverPosition(true); audio.pause(); }
  enCours = brief.date;
  aJoue = false;
  ecouteEnvoyee = !!brief.ecoute;
  audio.src = sourceAudio(info);
  audio.load();
  appliquerVitesse();
  metadonneesMedia();
  $('#hors-ligne').hidden = true;
  memorise(info).then((ok) => { if (brief?.audioInfo === info) $('#hors-ligne').hidden = !ok; }).catch(() => {});
  if (brief.date === (brief.maintenant && brief.maintenant.date)) memoriserAudio(info).catch(() => {});
}

const urlReseau = (info) => `${info.url}?v=${encodeURIComponent(info.version || '')}`;
const urlHorsLigne = (info) => `${info.url.replace(/^audio\//, 'audio-cache/')}?v=${encodeURIComponent(info.version || '')}`;
function sourceAudio(info) { return navigator.onLine ? urlReseau(info) : urlHorsLigne(info); }

// Reprise : la position la plus récente entre ce téléphone et le serveur.
audio.addEventListener('loadedmetadata', () => {
  if (!brief || enCours !== brief.date) return;
  const serveur = brief.progression, local = positionLocale(brief.date);
  const choix = [serveur, local].filter(Boolean).sort((a, b) => (b.maj || 0) - (a.maj || 0))[0];
  const d = audio.duration;
  if (choix && Number.isFinite(d) && choix.position > 5 && choix.position < d - 5 && audio.currentTime < 1) audio.currentTime = choix.position;
  appliquerVitesse();
  majBoutons();
});

function appliquerVitesse() {
  audio.defaultPlaybackRate = reglages.vitesse; // iOS remet la vitesse à 1 à chaque nouveau fichier : on la redonne
  audio.playbackRate = reglages.vitesse;
  $('#vitesse').textContent = vitesseTexte(reglages.vitesse);
  $('#vitesse').setAttribute('aria-label', `Vitesse de lecture : ${vitesseTexte(reglages.vitesse)}. Appuie pour changer.`);
}

async function lire() {
  try {
    await audio.play(); // seulement à l'appui de l'utilisateur : iOS bloque tout démarrage automatique
    appliquerVitesse();
    suivre = true;
    if (brief) memoriserAudio(brief.audioInfo).catch(() => {});
  } catch (err) {
    avis(`La lecture n’a pas démarré (${err.message}). Appuie de nouveau sur lecture.`, { erreur: true });
  }
}
const basculer = () => (audio.paused ? lire() : audio.pause());
const saut = (s) => { if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + s)); };

function chapitresAudio() { return brief?.audioInfo?.chapitres ?? []; }
function indexChapitre(t) {
  const c = chapitresAudio();
  let k = -1;
  c.forEach((x, i) => { if (t >= x.debut - 0.3) k = i; });
  return k;
}
// Les chapitres de l'audio suivent l'ordre des chapitres lus ; on retrouve celui du texte correspondant.
const indexTexte = (k) => brief.chapitres.findIndex((c, i) => c.audio && brief.chapitres.filter((x, j) => j < i && x.audio).length === k);
function sauterAuChapitre(iTexte) {
  const c = brief.chapitres[iTexte];
  if (!c?.audio || enCours !== brief.date) return;
  audio.currentTime = c.audio.debut + 0.05;
  suivre = true;
  lire();
}
function chapitreAudioSuivant(delta) {
  const t = audio.currentTime, k = indexChapitre(t), c = chapitresAudio();
  let cible;
  if (delta < 0) cible = t - (c[k]?.debut ?? 0) > 3 ? k : k - 1; // comme un podcast : d'abord le début du chapitre, puis le précédent
  else cible = k + 1;
  if (cible < 0) cible = 0;
  if (cible >= c.length) return;
  audio.currentTime = c[cible].debut + 0.05;
}

$('#lecture').addEventListener('click', basculer);
$('#mini-lecture').addEventListener('click', basculer);
$('#recul').addEventListener('click', () => saut(-15));
$('#avance').addEventListener('click', () => saut(15));
$('#chapitre-precedent').addEventListener('click', () => chapitreAudioSuivant(-1));
$('#chapitre-suivant').addEventListener('click', () => chapitreAudioSuivant(1));
$('#vitesse').addEventListener('click', async () => {
  const i = VITESSES.indexOf(reglages.vitesse);
  reglages.vitesse = VITESSES[(i + 1) % VITESSES.length];
  appliquerVitesse();
  // Le choix de la vitesse sur le lecteur ne change pas le réglage par défaut : il vaut pour cette écoute.
});

// Barre de progression : on déplace la tête de lecture seulement au relâchement (pas de saccades pendant le glissement).
const barre = $('#barre');
let glisse = false;
function majBarre(t, d) {
  barre.style.setProperty('--p', String(d > 0 ? t / d : 0));
  barre.setAttribute('aria-valuetext', `${temps(t)} sur ${temps(d)}`);
}
barre.addEventListener('input', () => {
  glisse = true;
  const t = barre.value / 1000 * (audio.duration || 0);
  $('#temps-courant').textContent = temps(t);
  majBarre(t, audio.duration || 0);
});
barre.addEventListener('change', () => { if (Number.isFinite(audio.duration)) audio.currentTime = barre.value / 1000 * audio.duration; glisse = false; });

function majBoutons() {
  const lecture = !audio.paused && enCours === brief?.date;
  const general = !audio.paused;
  for (const [pl, pa] of [['#icone-lecture', '#icone-pause'], ['#mini-icone-lecture', '#mini-icone-pause']]) {
    $(pl).hidden = pl.startsWith('#mini') ? general : lecture;
    $(pa).hidden = pl.startsWith('#mini') ? !general : !lecture;
  }
  $('#lecture').setAttribute('aria-label', lecture ? 'Pause' : 'Lecture');
  $('#mini-lecture').setAttribute('aria-label', general ? 'Pause' : 'Lecture');
  $('#suivre').hidden = !(lecture && !suivre);
  document.body.classList.toggle('joue', lecture); // petit égaliseur sur le chapitre en cours
}

function surbrillance() {
  if (!brief) return;
  const k = enCours === brief.date ? indexChapitre(audio.currentTime) : -1;
  const i = k >= 0 ? indexTexte(k) : -1;
  if (i === chapitreCourant) return;
  chapitreCourant = i;
  for (const el of document.querySelectorAll('#liste-chapitres li, #textes .chapitre')) el.classList.toggle('en-cours', Number(el.dataset.i) === i);
  if (i >= 0 && !audio.paused && suivre) $(`#chapitre-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  majMini();
}

// La mini-barre : visible dès qu'un brief est chargé et que sa carte n'est plus à l'écran (ou qu'on est dans un autre onglet).
function majMini() {
  const mini = $('#mini');
  const actif = enCours && aJoue && !!audio.src && (brief?.date === enCours || !!lsGet('brief:titre')); // seulement une fois la lecture démarrée
  const carte = $('#carte-lecteur');
  const surLecteur = route().nom === 'lecteur' && brief?.date === enCours;
  const carteVisible = surLecteur && !carte.hidden && carteALEcran;
  mini.hidden = !(actif && !carteVisible && route().nom !== 'connexion');
  if (!mini.hidden) {
    const b = brief?.date === enCours ? brief : null;
    $('#mini-titre').textContent = b?.titre || lsGet('brief:titre') || 'Brief du matin';
    const i = b ? chapitreCourant : -1;
    $('#mini-chapitre').textContent = i >= 0 ? b.chapitres[i].titre : 'Brief du matin';
    $('#mini-texte').setAttribute('href', `#${b?.date === (b?.maintenant?.date) ? 'aujourdhui' : `brief/${enCours}`}`);
  }
}
// La carte du lecteur est-elle à l'écran ? (IntersectionObserver : aucun calcul de mise en page à chaque défilement)
let carteALEcran = true;
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entrees) => { carteALEcran = entrees[0].intersectionRatio > 0.25; majMini(); }, { threshold: [0, 0.25, 0.5] }).observe($('#carte-lecteur'));
}
// Un geste de défilement manuel suspend le suivi automatique.
for (const ev of ['wheel', 'touchmove']) window.addEventListener(ev, () => { if (!audio.paused && suivre) { suivre = false; majBoutons(); } }, { passive: true });
$('#suivre').addEventListener('click', () => {
  suivre = true;
  const i = chapitreCourant;
  if (route().nom !== 'lecteur') location.hash = brief?.date === brief?.maintenant?.date ? '#aujourdhui' : `#brief/${enCours}`;
  else if (i >= 0) $(`#chapitre-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  majBoutons();
});

// Événements de l'élément <audio>
let dernierEnvoi = 0, dernierLocal = 0, dernierEtat = 0;
audio.addEventListener('play', () => { aJoue = true; majBoutons(); etatMedia('playing'); });
audio.addEventListener('pause', () => { majBoutons(); etatMedia('paused'); sauverPosition(true); });
audio.addEventListener('ended', () => { majBoutons(); etatMedia('paused'); marquerEcoute(); sauverPosition(true); });
audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime, d = audio.duration;
  if (!glisse && Number.isFinite(d) && d > 0) { barre.value = Math.round(t / d * 1000); $('#temps-courant').textContent = temps(t); majBarre(t, d); }
  if (Number.isFinite(d) && d > 0) $('#mini-progres').style.setProperty('--p', String(t / d));
  if (Number.isFinite(d) && d > 0 && !ecouteEnvoyee && t / d >= 0.9) marquerEcoute();
  const n = Date.now();
  if (n - dernierLocal > 5000) { dernierLocal = n; sauverPosition(false); }
  if (n - dernierEnvoi > 30000) { dernierEnvoi = n; sauverPosition(true); }
  if (n - dernierEtat > 1000) { dernierEtat = n; positionMedia(); }
  surbrillance();
});
// Si le réseau lâche en cours de lecture, on bascule sur l'audio gardé hors ligne, au même endroit.
audio.addEventListener('error', async () => {
  if (!brief?.audioInfo || enCours !== brief.date) return;
  const info = brief.audioInfo;
  if (audio.src.includes('/audio-cache/') || !(await memorise(info))) return;
  const t = audio.currentTime, etaitEnLecture = !audio.paused;
  audio.src = urlHorsLigne(info);
  audio.addEventListener('loadedmetadata', () => { audio.currentTime = t; appliquerVitesse(); if (etaitEnLecture) audio.play().catch(() => {}); }, { once: true });
});
window.addEventListener('offline', () => { if (brief?.audioInfo && audio.paused && enCours === brief.date && audio.currentTime === 0) memorise(brief.audioInfo).then((ok) => { if (ok) audio.src = urlHorsLigne(brief.audioInfo); }); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sauverPosition(true); });
window.addEventListener('pagehide', () => sauverPosition(true));

// Position gardée sur ce téléphone, et (de temps en temps) sur le serveur. « Écouté » à partir de 90 %.
function sauverPosition(serveur) {
  if (!enCours || !aJoue || !Number.isFinite(audio.duration) || audio.duration <= 0) return; // pas de lecture : la position enregistrée reste celle d'avant
  const p = { position: Math.floor(audio.currentTime), duree: Math.floor(audio.duration), ecoute: ecouteEnvoyee, maj: Date.now() };
  lsSet(cleLocale(enCours), JSON.stringify(p));
  if (brief?.date === enCours) brief.progression = p;
  if (serveur) api(`/api/briefs/${enCours}/progression`, { method: 'PUT', body: p }).catch(() => {});
}
function marquerEcoute() {
  if (ecouteEnvoyee) return;
  ecouteEnvoyee = true;
  sauverPosition(true);
}

// --- Media Session : écran verrouillé et Centre de contrôle ----------------------------------------
function metadonneesMedia() {
  if (!('mediaSession' in navigator) || !brief) return;
  lsSet('brief:titre', brief.titre);
  const base = new URL('.', location.href);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: brief.titre,
    artist: 'Brief du matin',
    album: dateLongue(brief.date),
    artwork: [
      { src: new URL('icons/icon-192.png', base).href, sizes: '192x192', type: 'image/png' },
      { src: new URL('icons/icon-512.png', base).href, sizes: '512x512', type: 'image/png' },
    ],
  });
}
function etatMedia(etat) { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = etat; }
function positionMedia() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, audio.duration) });
  } catch { /* valeurs refusées par le navigateur : sans importance */ }
}
if ('mediaSession' in navigator) {
  const action = (nom, fn) => { try { navigator.mediaSession.setActionHandler(nom, fn); } catch { /* action non gérée par ce navigateur */ } };
  action('play', () => lire());
  action('pause', () => audio.pause());
  action('seekbackward', (d) => saut(-(d?.seekOffset || 15)));
  action('seekforward', (d) => saut(d?.seekOffset || 15));
  action('previoustrack', () => chapitreAudioSuivant(-1)); // précédent / suivant = chapitres
  action('nexttrack', () => chapitreAudioSuivant(1));
  action('seekto', (d) => { if (d?.seekTime != null && Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, d.seekTime); });
}

// --- Audio gardé hors ligne (Cache API) ---------------------------------------------------------------
// Le fichier complet est gardé après la première lecture (ou à l'ouverture du brief du jour), 3 briefs au plus.
// Hors ligne, l'élément <audio> lit /audio-cache/… : le service worker le sert depuis ce cache, avec les requêtes « Range ».
async function memorise(info) {
  if (!('caches' in window)) return false;
  return !!(await (await caches.open('brief-audio')).match(urlReseau(info)));
}
async function memoriserAudio(info) {
  if (!info || !('caches' in window) || !navigator.onLine) return;
  const cache = await caches.open('brief-audio');
  const cle = urlReseau(info);
  if (await cache.match(cle)) return;
  const res = await fetch(cle, { credentials: 'same-origin' }); // sans « Range » : réponse complète, la seule qu'on puisse garder
  if (res.status !== 200) return;
  await cache.put(cle, res);
  if (brief?.audioInfo && urlReseau(brief.audioInfo) === cle) $('#hors-ligne').hidden = false;
  const cles = await cache.keys();
  // On ne garde que les 3 plus récents (par date dans le nom) et une seule version par date.
  const parDate = new Map();
  for (const r of cles) { const d = /audio\/(\d{4}-\d{2}-\d{2})\.mp3/.exec(r.url)?.[1]; if (d) parDate.set(d, [...(parDate.get(d) || []), r]); }
  const dates = [...parDate.keys()].sort().reverse();
  for (const [i, d] of dates.entries()) {
    const reqs = parDate.get(d);
    const aSupprimer = i >= 3 ? reqs : reqs.filter((r) => r.url !== new URL(cle, location.href).href && d === (/audio\/(\d{4}-\d{2}-\d{2})/.exec(cle)[1]));
    for (const r of aSupprimer) await cache.delete(r);
  }
}

// --- Dernier recours : la voix de l'iPhone (speechSynthesis) ------------------------------------------
let parle = false;
function arreterVoix() {
  parle = false;
  speechSynthesis.cancel();
  $('#lire-voix').textContent = 'Lire avec la voix de l’iPhone';
  for (const el of document.querySelectorAll('.chapitre.parle')) el.classList.remove('parle');
  for (const el of document.querySelectorAll('.chapitre p.lue')) el.classList.remove('lue');
}
$('#lire-voix').addEventListener('click', () => {
  if (parle) return arreterVoix();
  if (!brief) return;
  parle = true;
  $('#lire-voix').textContent = 'Arrêter la lecture';
  const voixFr = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('fr') && v.localService) || speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('fr'));
  const file = [];
  brief.chapitres.forEach((c, i) => {
    const paras = (c.voix || '').split('\n').filter(Boolean);
    paras.forEach((p, j) => file.push({ i, j, texte: p }));
  });
  const suite = (n) => {
    if (!parle || n >= file.length) return arreterVoix();
    const { i, texte } = file[n];
    const art = $(`#chapitre-${i}`);
    for (const el of document.querySelectorAll('.chapitre.parle')) el.classList.remove('parle');
    art?.classList.add('parle');
    if (art && suivre) art.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const u = new SpeechSynthesisUtterance(texte); // une phrase à la fois : iOS coupe les très longs textes
    u.lang = 'fr-FR';
    if (voixFr) u.voice = voixFr;
    u.rate = Math.min(1.5, reglages.vitesse);
    u.onend = () => suite(n + 1);
    u.onerror = () => arreterVoix();
    speechSynthesis.speak(u);
  };
  suite(0);
});

// --- Archives -------------------------------------------------------------------------------------
let minuteurRecherche;
function etatArchives(icoNom, titre, texte) {
  const e = $('#archives-etat');
  vider(e);
  e.hidden = !titre;
  if (titre) e.append(icone(icoNom), h('strong', { texte: titre }), texte ? h('span', { texte }) : null);
}
async function ouvrirArchives() {
  const q = $('#recherche').value.trim();
  const ul = $('#liste-archives');
  if (!ul.children.length) etatArchives('wave', 'Chargement…'); // la première fois seulement : ensuite la liste reste affichée pendant la mise à jour
  const r = await api(`/api/briefs${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  vider(ul);
  if (!r.briefs.length) etatArchives('archive', q ? `Aucun brief ne contient « ${q} »` : 'Aucun brief pour le moment', q ? 'La recherche porte sur les titres et sur les textes déjà ouverts.' : 'Le premier arrive demain matin, vers 6 h 30.');
  else etatArchives(null, r.perime ? '' : null);
  if (r.briefs.length && r.perime) { const e = $('#archives-etat'); e.hidden = false; vider(e); e.append(icone('alert'), h('span', { texte: 'Liste non actualisée : Notion ne répond pas.' })); }
  for (const b of r.briefs) {
    const local = positionLocale(b.date);
    const ecoute = b.ecoute || local?.ecoute;
    const jour = new Date(b.date + 'T12:00:00Z');
    const [statutIcone, statutTexte] = ecoute ? ['check', 'écouté'] : b.audio ? ['headphones', 'audio disponible'] : b.audioExpire ? ['file', 'texte seul (audio supprimé après 30 jours)'] : ['file', 'texte seul, audio en préparation'];
    ul.append(h('li', {}, h('a', { href: `#brief/${b.date}`, 'aria-label': `${b.titre}, ${minutes(b.dureeMin) || 'durée inconnue'}, ${statutTexte}` },
      h('span', { class: 'jour', 'aria-hidden': 'true' }, h('b', { texte: String(jour.getUTCDate()) }), h('span', { texte: MOIS[jour.getUTCMonth()].replace('.', '') })),
      h('span', { class: 'corps' },
        h('span', { class: 't', texte: b.titre }),
        h('span', { class: 'm', texte: [minutes(b.dureeMin), ...(b.sujets || [])].filter(Boolean).join(' · ') })),
      h('span', { class: `statut${ecoute ? ' ok' : ''}`, title: statutTexte }, icone(statutIcone)))));
  }
}
$('#recherche').addEventListener('input', () => {
  clearTimeout(minuteurRecherche);
  minuteurRecherche = setTimeout(() => ouvrirArchives().catch((e) => etatArchives('alert', 'Recherche impossible', e.message)), 300);
});

// --- Réglages -------------------------------------------------------------------------------------
async function ouvrirReglages() {
  const r = await api('/api/reglages');
  reglages = { ...reglages, vitesse: r.vitesse, rappel: r.rappel };
  lsSet('brief:vitesse', String(r.vitesse));
  const seg = $('#choix-vitesse');
  vider(seg);
  for (const v of VITESSES) {
    const b = h('button', { type: 'button', 'aria-pressed': String(v === r.vitesse), texte: vitesseTexte(v) });
    b.addEventListener('click', async () => {
      const n = await api('/api/reglages', { method: 'PUT', body: { vitesse: v } });
      reglages.vitesse = n.vitesse;
      lsSet('brief:vitesse', String(n.vitesse));
      appliquerVitesse();
      for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b));
    });
    seg.append(b);
  }
  $('#rappel-actif').checked = !!r.rappel;
  $('#rappel-heure').value = r.rappel || '07:00';
  $('#rappel-aide').textContent = 'Une notification, une fois par jour, quand l’audio du matin est prêt. Sur iPhone : il faut avoir ajouté l’appli à l’écran d’accueil (iOS 16.4 ou plus).';
  const v = r.voix;
  const lignes = [
    [r.mode === 'demo' ? 'ko' : 'ok', r.mode === 'demo' ? 'Mode démo : brief fictif, Notion n’est pas relié.' : 'Notion est relié.'],
  ];
  for (const m of v.moteurs?.length ? v.moteurs : [{ libelle: v.moteur, prete: v.prete, erreur: v.erreur }]) {
    const essai = m.prete && v.essaiMs && (v.moteurs?.length || 1) === 1 ? `, essai en ${(v.essaiMs / 1000).toFixed(1).replace('.', ',')} s` : '';
    lignes.push(m.prete ? ['ok', `Voix prête : ${m.libelle}${m.enLigne ? ' (en ligne)' : ''}${essai}.`]
      : v.installation ? ['', `Voix en cours d’installation : ${m.libelle} (la première fois, quelques minutes).`]
      : ['ko', `Voix indisponible : ${m.libelle}${m.erreur ? ` — ${m.erreur}` : ''}.`]);
  }
  const ul = $('#diagnostic');
  vider(ul);
  for (const [classe, texte] of lignes) ul.append(h('li', { class: classe, texte }));
  majAudios(r);
  $('#badge-mode').hidden = r.mode !== 'demo';
  window.cleRappel = r.cleRappel;
}

const message = (t, erreur) => { const m = $('#rappel-message'); m.textContent = t; m.classList.toggle('erreur', !!erreur); };
async function abonnerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Les notifications ne sont pas disponibles ici. Sur iPhone, ajoute d’abord l’appli à l’écran d’accueil.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du téléphone.');
  const reg = await navigator.serviceWorker.ready;
  const cle = Uint8Array.from(atob(window.cleRappel.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const abo = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle }));
  await api('/api/rappel/abonnement', { method: 'POST', body: abo.toJSON() });
}
async function desabonnerPush() {
  const reg = await navigator.serviceWorker?.ready;
  const abo = await reg?.pushManager.getSubscription();
  if (abo) {
    await api('/api/rappel/abonnement', { method: 'DELETE', body: { endpoint: abo.endpoint } }).catch(() => {});
    await abo.unsubscribe();
  }
}
async function enregistrerRappel() {
  const actif = $('#rappel-actif').checked;
  try {
    if (actif) await abonnerPush();
    else await desabonnerPush();
    await api('/api/reglages', { method: 'PUT', body: { rappel: actif ? $('#rappel-heure').value || '07:00' : null } });
    message(actif ? `Rappel réglé à partir de ${$('#rappel-heure').value}.` : 'Rappel désactivé.');
  } catch (err) {
    $('#rappel-actif').checked = false;
    message(err.message, true);
  }
}
$('#rappel-actif').addEventListener('change', enregistrerRappel);
$('#rappel-heure').addEventListener('change', () => { if ($('#rappel-actif').checked) enregistrerRappel(); });

// --- Connexion ------------------------------------------------------------------------------------
$('#form-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('#form-connexion .message');
  try {
    await api('/api/connexion', { method: 'POST', body: { motDePasse: e.target.motDePasse.value } });
    e.target.reset();
    m.textContent = '';
    location.hash = '#aujourdhui';
    afficher();
  } catch (err) {
    m.textContent = err.message;
    m.classList.add('erreur');
  }
});

// --- Démarrage ------------------------------------------------------------------------------------
async function demarrer() {
  try {
    const etat = await api('/api/etat');
    $('#badge-mode').hidden = etat.mode !== 'demo';
    if (etat.motDePasse && !etat.connecte && location.hash !== '#connexion') location.hash = '#connexion';
  } catch { /* hors ligne : on essaie quand même d'afficher ce qui est en cache */ }
  try {
    const r = await fetch('/api/reglages', { credentials: 'same-origin' });
    if (r.ok) reglages = { ...reglages, ...(await r.json()) };
  } catch { /* idem */ }
  appliquerVitesse();
  afficher();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
demarrer();

// --- Réglages : refaire les audios déjà prêts avec la voix actuelle ------------------------------------------------
let suiviLot = null;
function majAudios(r) {
  const a = r.audios || { gardes: 0, autreVoix: 0, lot: {} };
  const enCours = !!a.lot.enCours;
  $('#audios-etat').textContent = a.gardes
    ? `${a.gardes} audio${a.gardes > 1 ? 's' : ''} gardé${a.gardes > 1 ? 's' : ''} (30 jours), dont ${a.autreVoix} fait${a.autreVoix > 1 ? 's' : ''} avec une autre voix que « ${r.voix.moteur} ».`
    : 'Aucun audio gardé pour le moment.';
  const bouton = $('#refaire-audios');
  bouton.disabled = enCours || !a.gardes || !r.voix.prete;
  $('#audios-message').textContent = enCours ? `Fabrication en cours : ${a.lot.fait} sur ${a.lot.total}. Tu peux quitter cet écran.` : (!r.voix.prete && a.gardes ? 'La voix n’est pas prête : voir « Sur le serveur ».' : '');
  clearTimeout(suiviLot);
  if (enCours && route().nom === 'reglages') suiviLot = setTimeout(() => api('/api/reglages').then(majAudios).catch(() => {}), 4000);
}
$('#refaire-audios').addEventListener('click', async () => {
  try {
    const r = await api('/api/audio/refaire', { method: 'POST', body: {} });
    $('#audios-message').textContent = `${r.nombre} audio${r.nombre > 1 ? 's' : ''} à refaire, le plus récent d’abord.`;
    suiviLot = setTimeout(() => api('/api/reglages').then(majAudios).catch(() => {}), 1500);
  } catch (err) {
    $('#audios-message').textContent = err.message;
  }
});
