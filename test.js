// Vérifications rapides : npm test (aucun réseau, ni Notion, ni Piper : la voix est remplacée par un son de test fabriqué avec ffmpeg)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execFileSync, execFile } = require('child_process');

const { pourLaVoix, retirerMarkdown } = require('./nettoyage');
const { analyserMarkdown, analyserNotion } = require('./parseur');
const { parisDe, ajouterJours, dateValide, dateLisible } = require('./temps');
const { prochaineVerification } = require('./planificateur');
const { creerApp } = require('./server');
const { creerVoix } = require('./voix');
const { urlVoix, modeleCompatible } = require('./moteurs/piper');
const azure = require('./moteurs/azure');
const { preparer, nombreEnLettres, ordinal } = require('./prononciation');
const { configuration } = require('./voix');
const { limiteur } = require('./widget');
const demo = require('./demo');

// Au démarrage du conteneur (Docker), seuls les tests rapides tournent : sur un NAS à processeur ARM, les tests qui lancent ffmpeg
// prennent 4 à 12 minutes et retardent d'autant le démarrage. `TEST_COMPLET=1 npm test` lance tout ; en local, tout tourne par défaut.
const rapide = process.env.TEST_COMPLET !== '1' && (process.env.TEST_RAPIDE === '1' || fs.existsSync('/.dockerenv'));
const ffmpegOk = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const sansFfmpeg = !ffmpegOk || rapide;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brief-test-'));

// --- Nettoyage du texte avant la voix --------------------------------------------------------------

test('nettoyage : Markdown, adresses, émojis et symboles', () => {
  const t = pourLaVoix('## Titre\n**Bonjour** 🌞 voici [un lien](https://x.fr/a?b=1) et https://example.com/test.\n- puce un\nIl fait 21 °C, 12 % de plus, 5€ ou €7, 3,5 M€ & le n° 3 vaut +4 points. 🇫🇷👍🏽');
  assert.ok(!/[#*\[\]()]|https?:|🌞|🇫🇷|👍/.test(t), t);
  assert.ok(t.includes('Bonjour voici un lien'));
  assert.ok(t.includes('21 degrés Celsius'));
  assert.ok(t.includes('12 pour cent'));
  assert.ok(t.includes('5 euros') && t.includes('7 euros'));
  assert.ok(t.includes('3,5 millions d’euros'));
  assert.ok(t.includes('numéro 3') && t.includes('plus 4') && t.includes(' et '));
  assert.ok(!t.includes('€') && !t.includes('%'));
  assert.ok(t.split('\n').every((l) => /[.!?]$/.test(l)), 'chaque ligne finit par une ponctuation');
});

test('nettoyage : le texte parlé reste intact', () => {
  const phrase = "Le vote solennel, prévu hier à l'Assemblée nationale, a été reporté.";
  assert.strictEqual(pourLaVoix(phrase), phrase);
  assert.strictEqual(pourLaVoix('   \n\n  '), '');
  assert.strictEqual(retirerMarkdown('un **mot** et _un autre_ et snake_case'), 'un mot et un autre et snake_case');
});

// --- Lecture de la page Notion -----------------------------------------------------------------------

const PAGE = `## Ta journée

Bonjour, voici ton brief. 12 % des mails sont urgents.

Deuxième paragraphe.

Sources :

- Notion

## Actu France et monde

Le budget est reporté.

Sources :

- [Budget 2027 : calendrier (Public Sénat)](https://www.publicsenat.fr/actualites/a)
- [Headlines (Democracy Now)](https://www.democracynow.org/2026/11/3/headlines)

## IA et tech

Un nouveau modèle est sorti.

Sources :

- [Un modèle (Tom's Hardware)](https://tomshardware.com/x)

## Sport, jeux vidéo et culture

Le PSG a gagné six à zéro.
`;

test('parseur : quatre chapitres, texte, sources avec titre et site', () => {
  const r = analyserMarkdown(PAGE);
  assert.deepStrictEqual(r.chapitres.map((c) => c.titre), ['Ta journée', 'Actu France et monde', 'IA et tech', 'Sport, jeux vidéo et culture']);
  assert.strictEqual(r.chapitres[0].texte, 'Bonjour, voici ton brief. 12 % des mails sont urgents.\n\nDeuxième paragraphe.');
  assert.deepStrictEqual(r.chapitres[0].sources, [{ titre: 'Notion', url: null, site: '' }]); // source sans lien
  assert.deepStrictEqual(r.chapitres[1].sources[0], { titre: 'Budget 2027 : calendrier', url: 'https://www.publicsenat.fr/actualites/a', site: 'Public Sénat' });
  assert.strictEqual(r.chapitres[1].sources[1].site, 'Democracy Now');
  assert.deepStrictEqual(r.chapitres[3].sources, []); // chapitre sans sources
  assert.ok(r.mots > 20);
  assert.ok(!r.chapitres[1].texte.includes('Sources'), 'les sources ne sont jamais dans le texte parlé');
});

test('parseur : tolérant (chapitre en moins, titres différents, sources en ligne, texte avant le premier titre)', () => {
  const r = analyserMarkdown(`Petit mot avant les chapitres.

# Chapitre 1 : Ma journée
Texte un.
**Sources** : [A](https://a.fr), [B](https://www.b.fr/x)

### Actualités
Texte deux.

Source :
- [C (Le Monde)](https://lemonde.fr/c)
Un paragraphe après les sources.

## Chapitre vide
`);
  assert.deepStrictEqual(r.chapitres.map((c) => c.titre), ['Introduction', 'Ma journée', 'Actualités']);
  assert.deepStrictEqual(r.chapitres[1].sources.map((s) => s.site), ['a.fr', 'b.fr']);
  assert.strictEqual(r.chapitres[2].texte, 'Texte deux.\n\nUn paragraphe après les sources.');
  assert.strictEqual(r.chapitres[2].sources[0].site, 'Le Monde');
  assert.deepStrictEqual(analyserMarkdown('').chapitres, []);
});

test('parseur : les adresses dangereuses ne deviennent jamais des liens', () => {
  const r = analyserMarkdown('## C\nTexte.\nSources :\n- [Piège](javascript:alert(1))\n- [Données](data:text/html,x)\n- [Bon](https://ok.fr/x)');
  const avecUrl = r.chapitres[0].sources.filter((s) => s.url);
  assert.deepStrictEqual(avecUrl.map((s) => s.url), ['https://ok.fr/x']);
});

test('parseur : blocs de l\'API Notion (titres, paragraphes, puces, liens)', () => {
  const riche = (t, href) => [{ type: 'text', plain_text: t, href: href || null, text: { content: t, link: href ? { url: href } : null } }];
  const blocs = [
    { type: 'heading_2', heading_2: { rich_text: riche('Ta journée') } },
    { type: 'paragraph', paragraph: { rich_text: riche('Bonjour <b>toi</b> & merci.') } },
    { type: 'paragraph', paragraph: { rich_text: [] } },
    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', plain_text: 'Sources :', annotations: { bold: true }, href: null }] } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: riche('Notion') } },
    { type: 'heading_2', heading_2: { rich_text: riche('IA et tech') } },
    { type: 'paragraph', paragraph: { rich_text: riche('Du texte.') } },
    { type: 'divider', divider: {} },
    { type: 'code', code: { rich_text: riche('rm -rf /') } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', plain_text: 'Source ', href: null }] } },
    { type: 'heading_3', heading_3: { rich_text: riche('Sources') } },
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: riche('Article (Site)', 'https://exemple.fr/a') } },
  ];
  const r = analyserNotion(blocs);
  assert.strictEqual(r.chapitres.length, 2);
  assert.strictEqual(r.chapitres[0].texte, 'Bonjour <b>toi</b> & merci.'); // gardé tel quel : l'écran l'affiche comme du texte
  assert.ok(!JSON.stringify(r).includes('rm -rf'), 'un bloc de code est ignoré');
  assert.deepStrictEqual(r.chapitres[1].sources, [{ titre: 'Article', url: 'https://exemple.fr/a', site: 'Site' }]);
});

// --- Dates et planning ---------------------------------------------------------------------------------

test('dates de Paris', () => {
  assert.deepStrictEqual(parisDe(new Date('2026-11-05T05:21:00Z')), { date: '2026-11-05', heure: 6, minute: 21, seconde: 0, minutes: 381 });
  assert.strictEqual(parisDe(new Date('2026-07-01T22:30:00Z')).date, '2026-07-02'); // heure d'été : déjà le lendemain à Paris
  assert.strictEqual(ajouterJours('2026-11-01', -30), '2026-10-02');
  assert.ok(dateValide('2026-02-28') && !dateValide('2026-02-30') && !dateValide('../etc'));
  assert.strictEqual(dateLisible('2026-11-05'), 'jeudi 5 novembre');
});

test('planning : toutes les 10 minutes de 6 h 30 à 10 h, puis toutes les heures', () => {
  const prochain = (iso) => { const r = prochaineVerification(new Date(iso)); return `${String(Math.floor(r.minutes / 60)).padStart(2, '0')}:${String(r.minutes % 60).padStart(2, '0')}`; };
  assert.strictEqual(prochain('2026-11-05T04:10:00Z'), '06:00'); // 5 h 10 à Paris
  assert.strictEqual(prochain('2026-11-05T05:10:00Z'), '06:30');
  assert.strictEqual(prochain('2026-11-05T05:30:00Z'), '06:40');
  assert.strictEqual(prochain('2026-11-05T05:31:00Z'), '06:40');
  assert.strictEqual(prochain('2026-11-05T08:55:00Z'), '10:00');
  assert.strictEqual(prochain('2026-11-05T09:00:00Z'), '11:00');
  assert.strictEqual(prochain('2026-11-05T22:30:00Z'), '00:00');
  const dans = prochaineVerification(new Date('2026-11-05T05:31:00Z')).quand - new Date('2026-11-05T05:31:00Z');
  assert.strictEqual(dans, 9 * 60e3);
});

// --- Notion : la seule écriture est « Audio (URL) » et « Statut » --------------------------------------------

function fauxFetch(reponses) {
  const appels = [];
  const f = async (url, opts = {}) => {
    const chemin = url.replace('https://api.notion.com/v1', '');
    appels.push({ methode: opts.method || 'GET', chemin, corps: opts.body ? JSON.parse(opts.body) : null });
    const r = reponses(chemin, opts.method || 'GET', opts.body ? JSON.parse(opts.body) : null);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r };
  };
  return { f, appels };
}

test('Notion : retrouve la base par son titre, lit la liste en une requête, n\'écrit que deux propriétés', async () => {
  const notion = require('./notion');
  const avant = { fetch: global.fetch, t: process.env.NOTION_TOKEN, p: process.env.NOTION_PAGE_ID, b: process.env.NOTION_BASE_BRIEF };
  process.env.NOTION_TOKEN = 'ntn_test';
  process.env.NOTION_PAGE_ID = 'https://www.notion.so/Gestion-40d3a1514912807b95e2cd97d06ff5d9';
  delete process.env.NOTION_BASE_BRIEF;
  notion._reinitialiser();
  const page = (id, date, statut, extra = {}) => ({
    id, created_time: `${date}T04:21:00.000Z`, last_edited_time: `${date}T04:25:00.000Z`,
    properties: {
      Titre: { type: 'title', title: [{ plain_text: `Brief ${date}` }] }, Date: { type: 'date', date: { start: date } },
      Statut: { type: 'select', select: statut ? { name: statut } : null }, 'Audio (URL)': { type: 'url', url: null },
      'Nombre de mots': { type: 'number', number: 675 }, 'Durée estimée (min)': { type: 'number', number: 4.5 },
      Sujets: { type: 'multi_select', multi_select: [{ name: 'Perso' }, { name: 'Sport' }] }, ...extra,
    },
  });
  const { f, appels } = fauxFetch((chemin, methode) => {
    if (chemin.startsWith('/blocks/40d3a151-4912-807b-95e2-cd97d06ff5d9') || chemin.startsWith('/blocks/40d3a1514912807b95e2cd97d06ff5d9')) {
      return { results: [{ type: 'child_database', id: 'base-autre', child_database: { title: 'Présence' } }, { type: 'child_database', id: 'base-brief', child_database: { title: 'Brief du matin' } }], next_cursor: null };
    }
    if (chemin === '/databases/base-brief/query') return { results: [page('p1', '2026-11-05', 'Script prêt'), page('p0', '2026-11-04', 'Audio prêt', { Date: { type: 'date', date: null } })], next_cursor: null };
    if (chemin === '/pages/p1' && methode === 'PATCH') return page('p1', '2026-11-05', 'Audio prêt');
    throw new Error('appel inattendu : ' + methode + ' ' + chemin);
  });
  global.fetch = f;
  try {
    const liste = await notion.listerBriefs();
    assert.strictEqual(liste.length, 2);
    assert.deepStrictEqual({ ...liste[0], cree: undefined, modifie: undefined }, {
      id: 'p1', titre: 'Brief 2026-11-05', date: '2026-11-05', cree: undefined, modifie: undefined, statut: 'Script prêt', audioUrl: null, mots: 675, dureeMin: 4.5, sujets: ['Perso', 'Sport'],
    });
    assert.strictEqual(liste[1].date, null); // sans date : l'appli prendra le jour de création
    const posts = appels.filter((a) => a.chemin.endsWith('/query'));
    assert.strictEqual(posts.length, 1, 'une seule requête pour la liste');
    assert.deepStrictEqual(posts[0].corps.page_size, 100);

    await notion.marquerAudioPret('p1', 'https://nas.example/audio/2026-11-05.mp3');
    const ecritures = appels.filter((a) => a.methode !== 'GET' && !a.chemin.endsWith('/query'));
    assert.strictEqual(ecritures.length, 1);
    assert.strictEqual(ecritures[0].methode, 'PATCH');
    assert.strictEqual(ecritures[0].chemin, '/pages/p1');
    assert.deepStrictEqual(Object.keys(ecritures[0].corps), ['properties']);
    assert.deepStrictEqual(Object.keys(ecritures[0].corps.properties).sort(), ['Audio (URL)', 'Statut']);
    assert.deepStrictEqual(ecritures[0].corps.properties.Statut, { select: { name: 'Audio prêt' } });
    assert.deepStrictEqual(ecritures[0].corps.properties['Audio (URL)'], { url: 'https://nas.example/audio/2026-11-05.mp3' });
  } finally {
    global.fetch = avant.fetch;
    for (const [k, v] of [['NOTION_TOKEN', avant.t], ['NOTION_PAGE_ID', avant.p], ['NOTION_BASE_BRIEF', avant.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    notion._reinitialiser();
  }
});

// --- Outils pour les tests de fabrication --------------------------------------------------------------------

// Fausse voix : un son de test dont la durée suit le nombre de mots (ffmpeg fabrique le WAV).
const fausseVoix = (log = []) => (texte, wav) => new Promise((resolve, reject) => {
  log.push(texte);
  const secondes = Math.max(0.5, texte.split(/\s+/).length * 0.1);
  execFile('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secondes}:sample_rate=22050`, '-ac', '1', '-c:a', 'pcm_s16le', wav], (e) => (e ? reject(e) : resolve()));
});

// Faux Notion en mémoire, avec la liste des appels (pour vérifier ce qui est écrit).
function fauxNotion(pages) {
  const appels = [];
  const copie = ({ corps, ...p }) => ({ ...p });
  return {
    appels, pages, demo: false, actif: () => true,
    STATUT_SCRIPT: 'Script prêt', STATUT_AUDIO: 'Audio prêt',
    async listerBriefs() { appels.push('liste'); return pages.map(copie); },
    async lireCorps(id) { appels.push('corps ' + id); return pages.find((p) => p.id === id).corps; },
    async lirePage(id) { appels.push('page ' + id); return copie(pages.find((p) => p.id === id)); },
    async marquerAudioPret(id, url) {
      appels.push(`ecriture ${id} ${url}`);
      const p = pages.find((x) => x.id === id);
      Object.assign(p, { audioUrl: url, statut: 'Audio prêt', modifie: 'maj' });
      return copie(p);
    },
  };
}
const briefTest = (date, extra = {}) => {
  const a = analyserMarkdown(PAGE);
  return { id: `id-${date}`, titre: `Brief du ${date}`, date, statut: 'Script prêt', audioUrl: null, mots: 100, dureeMin: 4.5, sujets: ['Perso'], modifie: 'm', cree: `${date}T04:00:00Z`, corps: require('./parseur').blocsDepuisMarkdown(PAGE), ...extra, _a: a };
};
const MAINTENANT = () => new Date('2026-11-05T05:40:00Z'); // jeudi 5 novembre, 6 h 40 à Paris

function installer(pages, options = {}) {
  const dossier = tmp();
  const notion = fauxNotion(pages);
  const journal = [];
  const log = [];
  const s = creerApp({
    dossier, notion, maintenant: MAINTENANT, attentes: [5, 5], journal: (m) => journal.push(m), moteur: fausseVoix(log),
    env: { APP_PASSWORD: options.motDePasse, WIDGET_TOKEN: options.widget, URL_PUBLIQUE: 'https://nas.example:8447' },
    voix: creerVoix(dossier, { journal: () => {} }), ...options.app,
  });
  s.voix.etat.prete = true;
  return { ...s, dossier, notion, journal, log };
}

// --- Fabrication de l'audio ------------------------------------------------------------------------------------

test('audio : un seul MP3 avec le manifest des chapitres, puis Audio (URL) et Statut dans Notion', { skip: sansFfmpeg }, async () => {
  const b = briefTest('2026-11-05');
  const s = installer([b]);
  const fait = await s.audio.verifier();
  assert.deepStrictEqual(fait, ['2026-11-05']);

  const m = s.audio.manifest('2026-11-05');
  assert.ok(m, 'MP3 et manifest présents');
  assert.strictEqual(m.chapitres.length, 4);
  assert.strictEqual(m.chapitres[0].debut, 0);
  for (let i = 1; i < 4; i++) { // chaque chapitre commence après le précédent, avec un silence entre les deux
    assert.ok(Math.abs(m.chapitres[i].debut - (m.chapitres[i - 1].debut + m.chapitres[i - 1].duree + 0.9)) < 0.02);
  }
  const reel = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', s.audio.fichier('2026-11-05', 'mp3')]).toString());
  assert.ok(Math.abs(reel - m.duree) < 0.05 && m.duree >= m.chapitres[3].debut + m.chapitres[3].duree - 0.05);
  const codec = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', s.audio.fichier('2026-11-05', 'mp3')]).toString().trim();
  assert.strictEqual(codec, 'mp3');

  // La voix n'a lu que le texte parlé : ni sources, ni adresses, ni titres, ni symboles.
  assert.strictEqual(s.log.length, 4);
  assert.ok(s.log.every((t) => !/Sources|https?:|publicsenat|Notion|%|##/.test(t)), s.log.join('\n'));
  assert.ok(s.log[0].includes('12 pour cent'));

  // Notion : une seule écriture, après vérification de la page, avec l'adresse du fichier
  assert.deepStrictEqual(s.notion.appels.filter((a) => a.startsWith('ecriture')), ['ecriture id-2026-11-05 https://nas.example:8447/audio/2026-11-05.mp3']);
  assert.strictEqual(b.statut, 'Audio prêt');
  assert.ok(s.notion.appels.indexOf('page id-2026-11-05') < s.notion.appels.findIndex((a) => a.startsWith('ecriture')));

  // Pas de retraitement : une page qui a déjà son audio n'est pas refaite
  s.notion.appels.length = 0;
  s.log.length = 0;
  await s.audio.verifier();
  assert.strictEqual(s.log.length, 0);
  assert.ok(!s.notion.appels.some((a) => a.startsWith('ecriture')));
  // … sauf si le script a été réécrit (le nombre de mots change et le statut redevient « Script prêt »)
  Object.assign(b, { statut: 'Script prêt', mots: 140 });
  await s.audio.verifier();
  assert.strictEqual(s.log.length, 4);
  assert.strictEqual(s.audio.manifest('2026-11-05').mots, 140);
});

test('audio : pas de retraitement quand seul le statut est « Audio prêt » ; les pages trop anciennes sont ignorées', { skip: sansFfmpeg }, async () => {
  const s = installer([
    briefTest('2026-11-04', { statut: 'Audio prêt' }), // déjà traité par ailleurs
    briefTest('2026-10-01'),                            // plus de 30 jours : l'audio serait supprimé aussitôt
    briefTest('2026-11-03', { statut: 'Erreur' }),      // « Erreur » est réservé à la tâche Claude
  ]);
  assert.deepStrictEqual(await s.audio.verifier(), []);
  assert.strictEqual(s.log.length, 0);
  assert.ok(!s.notion.appels.some((a) => a.startsWith('ecriture')));
});

test('audio : si la voix échoue, deux nouvelles tentatives, puis le texte reste lisible, sans passer le statut à « Erreur »', { skip: sansFfmpeg }, async () => {
  const b = briefTest('2026-11-05');
  let essais = 0;
  const s = installer([b], { app: { moteur: async () => { essais++; throw new Error('Piper plante'); } } });
  await s.audio.verifier();
  assert.strictEqual(essais, 3, 'un essai + deux nouvelles tentatives');
  assert.strictEqual(s.audio.manifest('2026-11-05'), null);
  assert.strictEqual(b.statut, 'Script prêt', 'le statut n\'est pas touché');
  assert.ok(!s.notion.appels.some((a) => a.startsWith('ecriture')));
  const e = s.audio.etatDe('2026-11-05');
  assert.strictEqual(e.etat, 'echec');
  assert.match(e.message, /Piper plante/);
  // on ne s'acharne pas : la vérification suivante ne réessaie pas
  await s.audio.verifier();
  assert.strictEqual(essais, 3);
  // le texte reste lisible dans l'appli, avec le message
  const res = await get(s, '/api/briefs/2026-11-05');
  assert.strictEqual(res.json.audio, false);
  assert.strictEqual(res.json.generation.etat, 'echec');
  assert.strictEqual(res.json.chapitres.length, 4);
  assert.strictEqual(res.json.audioInfo, null);
});

test('audio : une voix qui réussit à la deuxième tentative suffit', { skip: sansFfmpeg }, async () => {
  const b = briefTest('2026-11-05');
  let essais = 0;
  const bonne = fausseVoix();
  const s = installer([b], { app: { moteur: async (t, w) => { if (++essais === 1) throw new Error('une fois'); return bonne(t, w); } } });
  await s.audio.verifier();
  assert.ok(s.audio.manifest('2026-11-05'));
  assert.strictEqual(b.statut, 'Audio prêt');
  assert.strictEqual(s.audio.etatDe('2026-11-05').etat, 'pret');
});

test('audio : le script réécrit pendant la fabrication n\'est pas déclaré prêt', { skip: sansFfmpeg }, async () => {
  const b = briefTest('2026-11-05');
  const bonne = fausseVoix();
  const s = installer([b], { app: { moteur: async (t, w) => { b.mots = 200; return bonne(t, w); } } }); // la tâche Claude réécrit pendant la voix
  await s.audio.verifier();
  assert.ok(!s.notion.appels.some((a) => a.startsWith('ecriture')));
  assert.strictEqual(b.statut, 'Script prêt');
});

test('audio : Notion injoignable à l\'écriture, l\'audio reste lisible et la mise à jour est refaite plus tard', { skip: sansFfmpeg }, async () => {
  const b = briefTest('2026-11-05');
  const s = installer([b]);
  const vrai = s.notion.marquerAudioPret;
  s.notion.marquerAudioPret = async () => { throw new Error('Notion : indisponible'); };
  await s.audio.verifier();
  assert.ok(s.audio.manifest('2026-11-05'));
  assert.strictEqual(b.statut, 'Script prêt');
  s.notion.marquerAudioPret = vrai;
  s.log.length = 0;
  await s.audio.verifier();
  assert.strictEqual(b.statut, 'Audio prêt');
  assert.strictEqual(s.log.length, 0, 'sans refaire la voix');
});

test('conservation : les fichiers audio de plus de 30 jours sont supprimés, le reste est gardé', () => {
  const s = installer([briefTest('2026-11-05')]);
  fs.mkdirSync(s.audio.dossierAudio, { recursive: true });
  for (const d of ['2026-09-30', '2026-10-05', '2026-11-01']) for (const e of ['mp3', 'json']) fs.writeFileSync(path.join(s.audio.dossierAudio, `${d}.${e}`), 'x');
  assert.strictEqual(s.audio.nettoyer(), 4); // 5 novembre − 30 jours = 6 octobre : les briefs du 30 septembre et du 5 octobre partent (MP3 + manifest)
  assert.deepStrictEqual(fs.readdirSync(s.audio.dossierAudio).sort(), ['2026-11-01.json', '2026-11-01.mp3']);
});

// --- Serveur ---------------------------------------------------------------------------------------------------------

function demarrer(s) {
  return new Promise((resolve) => {
    const srv = http.createServer(s.app).listen(0, '127.0.0.1', () => resolve(srv));
  });
}
async function requete(s, chemin, { methode = 'GET', corps, entetes = {} } = {}) {
  const srv = await demarrer(s);
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}${chemin}`, {
      method: methode, headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), ...entetes }, body: corps && JSON.stringify(corps), redirect: 'manual',
    });
    const octets = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(octets.toString()); } catch { /* pas du JSON */ }
    return { status: res.status, entetes: res.headers, octets, json };
  } finally {
    srv.close();
    srv.closeAllConnections?.();
  }
}
const get = (s, chemin, o) => requete(s, chemin, o);

test('serveur : mot de passe obligatoire pour l\'API ET pour les fichiers audio', { skip: sansFfmpeg }, async () => {
  const s = installer([briefTest('2026-11-05')], { motDePasse: 'secret-de-test' });
  await s.audio.verifier();
  assert.strictEqual((await get(s, '/api/briefs')).status, 401);
  assert.strictEqual((await get(s, '/api/briefs/2026-11-05')).status, 401);
  assert.strictEqual((await get(s, '/api/reglages')).status, 401);
  assert.strictEqual((await get(s, '/audio/2026-11-05.mp3')).status, 401);
  assert.strictEqual((await get(s, '/api/briefs', { entetes: { cookie: 'brief=' + 'a'.repeat(64) } })).status, 401);
  const etat = await get(s, '/api/etat');
  assert.deepStrictEqual({ ...etat.json }, { mode: 'notion', motDePasse: true, connecte: false });

  const mauvais = await requete(s, '/api/connexion', { methode: 'POST', corps: { motDePasse: 'faux' } });
  assert.strictEqual(mauvais.status, 401);
  const bon = await requete(s, '/api/connexion', { methode: 'POST', corps: { motDePasse: 'secret-de-test' } });
  assert.strictEqual(bon.status, 200);
  const cookie = bon.entetes.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const c = cookie.split(';')[0];
  assert.strictEqual((await get(s, '/api/briefs', { entetes: { cookie: c } })).status, 200);
  assert.strictEqual((await get(s, '/audio/2026-11-05.mp3', { entetes: { cookie: c } })).status, 200);
});

test('serveur : audio servi avec le bon type MIME et les requêtes Range (Safari, iOS)', { skip: sansFfmpeg }, async () => {
  const s = installer([briefTest('2026-11-05')]);
  await s.audio.verifier();
  const taille = fs.statSync(s.audio.fichier('2026-11-05', 'mp3')).size;
  const tout = await get(s, '/audio/2026-11-05.mp3');
  assert.strictEqual(tout.status, 200);
  assert.strictEqual(tout.entetes.get('content-type'), 'audio/mpeg');
  assert.strictEqual(tout.entetes.get('accept-ranges'), 'bytes');
  assert.strictEqual(tout.octets.length, taille);

  const morceau = await get(s, '/audio/2026-11-05.mp3', { entetes: { range: 'bytes=0-1' } }); // la première requête de Safari
  assert.strictEqual(morceau.status, 206);
  assert.strictEqual(morceau.entetes.get('content-range'), `bytes 0-1/${taille}`);
  assert.strictEqual(morceau.octets.length, 2);
  const milieu = await get(s, '/audio/2026-11-05.mp3', { entetes: { range: 'bytes=100-199' } });
  assert.strictEqual(milieu.status, 206);
  assert.ok(milieu.octets.equals(tout.octets.subarray(100, 200)));
  const fin = await get(s, '/audio/2026-11-05.mp3', { entetes: { range: 'bytes=-50' } });
  assert.strictEqual(fin.status, 206);
  assert.ok(fin.octets.equals(tout.octets.subarray(taille - 50)));
  assert.strictEqual((await get(s, '/audio/2026-11-05.mp3', { entetes: { range: `bytes=${taille + 10}-` } })).status, 416);
  // pas d'autre fichier que les MP3 des briefs
  assert.strictEqual((await get(s, '/audio/2026-11-05.json')).status, 404);
  assert.strictEqual((await get(s, '/audio/2020-01-01.mp3')).status, 404);
  assert.strictEqual((await get(s, '/audio/..%2Fserver.js')).status, 404);
});

test('serveur : liste, détail, chapitres rattachés à l\'audio, archives et recherche', { skip: sansFfmpeg }, async () => {
  const s = installer([briefTest('2026-11-05'), briefTest('2026-11-04', { statut: 'Audio prêt' }), briefTest('2026-09-20', { statut: 'Audio prêt' })]);
  await s.audio.verifier();
  const liste = (await get(s, '/api/briefs')).json;
  assert.deepStrictEqual(liste.maintenant, { date: '2026-11-05', heure: 6, minute: 40 });
  assert.deepStrictEqual(liste.briefs.map((b) => b.date), ['2026-11-05', '2026-11-04', '2026-09-20']);
  assert.strictEqual(liste.briefs[0].audio, true);
  assert.strictEqual(liste.briefs[1].audio, false);
  assert.strictEqual(liste.briefs[2].audioExpire, true);

  const d = (await get(s, '/api/briefs/2026-11-05')).json;
  assert.strictEqual(d.chapitres.length, 4);
  assert.deepStrictEqual(d.chapitres.map((c) => c.audio.debut), d.audioInfo.chapitres.map((c) => c.debut));
  assert.strictEqual(d.chapitres[1].sources.length, 2);
  assert.ok(d.audioInfo.url.endsWith('2026-11-05.mp3'));
  assert.ok(!d.chapitres[0].voix.includes('%'));

  // Texte lu seulement à l'ouverture, puis gardé : un second appel ne relit pas Notion
  const lectures = () => s.notion.appels.filter((a) => a.startsWith('corps id-2026-11-04')).length;
  assert.strictEqual(lectures(), 0);
  await get(s, '/api/briefs/2026-11-04');
  await get(s, '/api/briefs/2026-11-04');
  assert.strictEqual(lectures(), 1);

  // Recherche par mot du titre ou du texte (accents et majuscules ignorés)
  assert.strictEqual((await get(s, '/api/briefs?q=' + encodeURIComponent('PSG GAGNE'))).json.briefs.length, 2); // dans le texte (« gagné »), des textes déjà lus
  assert.strictEqual((await get(s, '/api/briefs?q=' + encodeURIComponent('psg inexistant'))).json.briefs.length, 0); // tous les mots doivent y être
  assert.strictEqual((await get(s, '/api/briefs?q=2026-09')).json.briefs.length, 1); // dans le titre
  assert.strictEqual((await get(s, '/api/briefs/2026-11-30')).status, 404);
  assert.strictEqual((await get(s, '/api/briefs/pas-une-date')).status, 400);
});

test('serveur : liste en cache 15 minutes, Notion non relu à chaque ouverture', async () => {
  let t = MAINTENANT().getTime();
  const s = installer([briefTest('2026-11-05')], { app: { maintenant: () => new Date(t) } });
  await get(s, '/api/briefs');
  await get(s, '/api/briefs');
  await get(s, '/api/briefs');
  assert.strictEqual(s.notion.appels.filter((a) => a === 'liste').length, 1);
  t += 16 * 60e3;
  await get(s, '/api/briefs');
  assert.strictEqual(s.notion.appels.filter((a) => a === 'liste').length, 2);
});

test('serveur : Notion en panne, la dernière liste connue reste affichée', async () => {
  let t = MAINTENANT().getTime();
  const s = installer([briefTest('2026-11-05')], { app: { maintenant: () => new Date(t) } });
  await get(s, '/api/briefs');
  s.notion.listerBriefs = async () => { throw new Error('Notion : panne'); };
  t += 20 * 60e3;
  const r = (await get(s, '/api/briefs')).json;
  assert.strictEqual(r.perime, true);
  assert.strictEqual(r.briefs.length, 1);
});

test('serveur : progression d\'écoute et réglages', async () => {
  const s = installer([briefTest('2026-11-05')]);
  const mauvais = await requete(s, '/api/briefs/2026-11-05/progression', { methode: 'PUT', corps: { position: -5, duree: 10 } });
  assert.strictEqual(mauvais.status, 400);
  const ok = await requete(s, '/api/briefs/2026-11-05/progression', { methode: 'PUT', corps: { position: 120, duree: 300, ecoute: false, maj: 1000 } });
  assert.strictEqual(ok.json.position, 120);
  await requete(s, '/api/briefs/2026-11-05/progression', { methode: 'PUT', corps: { position: 290, duree: 300, ecoute: true, maj: 2000 } });
  const ancien = await requete(s, '/api/briefs/2026-11-05/progression', { methode: 'PUT', corps: { position: 10, duree: 300, ecoute: false, maj: 1500 } });
  assert.strictEqual(ancien.json.position, 290, 'le plus récent gagne');
  const d = (await get(s, '/api/briefs/2026-11-05')).json;
  assert.strictEqual(d.ecoute, true);
  assert.strictEqual(d.progression.position, 290);

  assert.strictEqual((await requete(s, '/api/reglages', { methode: 'PUT', corps: { vitesse: 3 } })).status, 400);
  assert.strictEqual((await requete(s, '/api/reglages', { methode: 'PUT', corps: { rappel: '25:00' } })).status, 400);
  const r = await requete(s, '/api/reglages', { methode: 'PUT', corps: { vitesse: 1.5, rappel: '07:15' } });
  assert.strictEqual(r.json.vitesse, 1.5);
  assert.strictEqual(r.json.rappel, '07:15');
  assert.strictEqual((await get(s, '/api/reglages')).json.vitesse, 1.5);
});

test('sécurité : le texte des briefs est servi comme du texte, jamais exécuté ni inséré en HTML', async () => {
  const b = briefTest('2026-11-05');
  b.corps = require('./parseur').blocsDepuisMarkdown('## <img src=x onerror=alert(1)>\nTexte <script>alert(1)</script> fin.\nSources :\n- [Piège](javascript:alert(1))\n- [Bon](https://ok.fr/a)');
  const s = installer([b]);
  const d = (await get(s, '/api/briefs/2026-11-05')).json;
  assert.ok(d.chapitres[0].texte.includes('<script>'), 'le texte est transmis tel quel, comme une chaîne JSON');
  assert.deepStrictEqual(d.chapitres[0].sources.map((x) => x.url), [null, 'https://ok.fr/a']);
  // L'interface n'insère jamais rien comme du HTML
  const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(js), 'pas d\'insertion HTML dans app.js');
  assert.match(js, /rel: 'noopener noreferrer'/);
  assert.match(js, /target: '_blank'/);
  const ent = await get(s, '/');
  assert.match(ent.entetes.get('content-security-policy'), /script-src 'self'/);
  assert.strictEqual(ent.entetes.get('x-content-type-options'), 'nosniff');
});

// --- Widget ----------------------------------------------------------------------------------------------------------

test('widget : mêmes règles que Repax et Argenx (jeton, cache seulement, limite de débit)', { skip: sansFfmpeg }, async () => {
  const jeton = crypto.randomBytes(24).toString('hex');
  const sans = installer([briefTest('2026-11-05')]);
  assert.strictEqual((await get(sans, '/api/widget/brief')).status, 404, 'sans WIDGET_TOKEN la route n\'existe pas');
  const court = installer([briefTest('2026-11-05')], { widget: 'trop-court' });
  assert.strictEqual((await get(court, '/api/widget/brief', { entetes: { authorization: 'Bearer trop-court' } })).status, 404);

  const s = installer([briefTest('2026-11-05')], { widget: jeton, motDePasse: 'secret' });
  const entetes = { authorization: `Bearer ${jeton}` };
  assert.strictEqual((await get(s, '/api/widget/brief', { entetes })).status, 503, 'liste pas encore chargée : jamais d\'appel à Notion pour le widget');
  assert.strictEqual(s.notion.appels.length, 0);
  await s.audio.verifier(); // charge la liste
  s.notion.appels.length = 0;
  assert.strictEqual((await get(s, '/api/widget/brief')).status, 401);
  assert.strictEqual((await get(s, '/api/widget/brief', { entetes: { authorization: 'Bearer faux' } })).status, 401);
  assert.strictEqual((await get(s, '/api/widget/brief', { entetes: { authorization: jeton } })).status, 401, 'le préfixe Bearer est obligatoire');
  const ok = await get(s, '/api/widget/brief', { entetes });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.entetes.get('cache-control'), 'no-store');
  assert.deepStrictEqual(Object.keys(ok.json).sort(), ['chaptersCount', 'date', 'durationMin', 'ready', 'title']);
  assert.strictEqual(ok.json.date, '2026-11-05');
  assert.strictEqual(ok.json.ready, true);
  assert.strictEqual(ok.json.chaptersCount, 4);
  assert.strictEqual(typeof ok.json.durationMin, 'number');
  assert.strictEqual(s.notion.appels.length, 0, 'le widget ne lit que le cache');
});

test('widget : sans brief aujourd\'hui, ready est faux', async () => {
  const jeton = 'j'.repeat(40);
  const s = installer([briefTest('2026-11-03')], { widget: jeton });
  await s.donnees.listerBriefs();
  const r = await get(s, '/api/widget/brief', { entetes: { authorization: `Bearer ${jeton}` } });
  assert.deepStrictEqual(r.json, { date: '2026-11-05', title: null, durationMin: null, ready: false, chaptersCount: 0 });
});

test('widget : limiteur de débit', () => {
  const l = limiteur(3, 1000);
  assert.deepStrictEqual([l('a', 0), l('a', 1), l('a', 2), l('a', 3) > 0, l('b', 3)], [0, 0, 0, true, 0]);
  assert.strictEqual(l('a', 1001), 0);
});

// --- Rappel du matin -------------------------------------------------------------------------------------------------

test('rappel : jeton VAPID valide, une seule notification par jour, abonnement périmé retiré', { skip: sansFfmpeg }, async () => {
  const envoyes = [];
  let statut = 201;
  const fetchImpl = async (url, opts) => { envoyes.push({ url, entetes: opts.headers }); return { status: statut }; };
  const b = briefTest('2026-11-05');
  const s = installer([b], { app: { fetchImpl } });
  await requete(s, '/api/reglages', { methode: 'PUT', corps: { rappel: '06:30' } });
  assert.strictEqual((await requete(s, '/api/rappel/abonnement', { methode: 'POST', corps: { endpoint: 'http://pas-https.example/x' } })).status, 400);
  await requete(s, '/api/rappel/abonnement', { methode: 'POST', corps: { endpoint: 'https://push.example/abo1' } });
  assert.strictEqual(await s.rappel.verifier(), false, 'pas de notification tant que l\'audio n\'est pas prêt');
  await s.audio.verifier();
  assert.strictEqual(await s.rappel.verifier(), true);
  assert.strictEqual(envoyes.length, 1);
  assert.strictEqual(await s.rappel.verifier(), false, 'une seule fois par jour');
  assert.strictEqual(envoyes.length, 1);

  const auth = envoyes[0].entetes.Authorization;
  const [, jwt, cle] = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
  const [e, c, sig] = jwt.split('.');
  assert.strictEqual(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://push.example');
  const pub = Buffer.from(cle, 'base64url');
  assert.strictEqual(pub.length, 65);
  const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') };
  assert.ok(crypto.verify('sha256', Buffer.from(`${e}.${c}`), { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));

  statut = 410; // le téléphone s'est désabonné
  fs.rmSync(path.join(s.dossier, 'rappel.json'));
  await s.rappel.verifier();
  assert.strictEqual(s.rappel.abonnements().length, 0);
});

// --- Voix : outils ---------------------------------------------------------------------------------------------------

test('voix : adresse de la voix Piper, épinglée sur une révision (jamais « main »)', () => {
  assert.strictEqual(urlVoix('fr_FR-siwis-medium'), 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/siwis/medium/fr_FR-siwis-medium');
  assert.ok(!urlVoix('fr_FR-upmc-medium').includes('/main/'));
});

test('mode démo : la base fictive suit la même interface que Notion', async () => {
  const d = demo.creer(MAINTENANT);
  const l = await d.listerBriefs();
  assert.ok(l.length >= 3 && l[0].date === '2026-11-05' && l.every((p) => !p.corps));
  const corps = await d.lireCorps(l[0].id);
  assert.ok(analyserNotion([]).chapitres.length === 0 && corps.length > 5);
  assert.strictEqual(d.actif(), false);
});

// --- Prononciation (chiffres, heures, ordinaux, sigles, mots anglais) -----------------------------------------------------

test('prononciation : nombres en lettres', () => {
  const cas = { 0: 'zéro', 21: 'vingt et un', 71: 'soixante et onze', 80: 'quatre-vingts', 81: 'quatre-vingt-un', 99: 'quatre-vingt-dix-neuf', 200: 'deux cents', 201: 'deux cent un',
    1000: 'mille', 2026: 'deux mille vingt-six', 80000: 'quatre-vingt mille', 1250000: 'un million deux cent cinquante mille', 3000000000: 'trois milliards' };
  for (const [n, mots] of Object.entries(cas)) assert.strictEqual(nombreEnLettres(Number(n)), mots, n);
  assert.deepStrictEqual([1, 2, 3, 4, 5, 9, 21, 100].map((n) => ordinal(n)), ['premier', 'deuxième', 'troisième', 'quatrième', 'cinquième', 'neuvième', 'vingt et unième', 'centième']);
});

test('prononciation : heures, ordinaux, unités et décimaux', () => {
  assert.strictEqual(preparer('Rendez-vous à 7 h 30, puis à 21 h et à 9h05.'), 'Rendez-vous à sept heures trente, puis à vingt et une heures et à neuf heures cinq.');
  assert.strictEqual(preparer('Le 1er mai, le 2e étage, la 3ème fois, le XXIe siècle.'), 'Le premier mai, le deuxième étage, la troisième fois, le vingt et unième siècle.');
  assert.strictEqual(preparer('Il roule à 3 km/h avec 12 Go et 2,5 kg, soit 3,05 de plus.'), 'Il roule à trois kilomètres-heure avec douze gigaoctets et deux virgule cinq kilos, soit trois virgule zéro cinq de plus.');
  assert.strictEqual(preparer('1 250 000 euros en 2025'), 'un million deux cent cinquante mille euros en deux mille vingt-cinq');
  assert.strictEqual(preparer('Le PSG, Le Monde, Louis XIV et la IIe guerre.'), 'Le PSG, Le Monde, Louis XIV et la deuxième guerre.', '« Le » n\'est pas un chiffre romain');
  assert.strictEqual(preparer('GPT-4 et F1, 4K'), 'Djé Pé Té-4 et F1, 4K', 'les chiffres collés à des lettres ne sont pas touchés');
});

test('prononciation : sigles et mots anglais écrits comme ils se prononcent, dictionnaire perso prioritaire', () => {
  assert.strictEqual(preparer('Sur ton iPhone, l’IA de Gemini.'), 'Sur ton aïfone, l’I A de Djémini.');
  assert.strictEqual(preparer('Pia et Time restent tels quels, mais Ocarina of Time change.'), 'Pia et Time restent tels quels, mais Okarina ove Taïme change.');
  assert.strictEqual(preparer('Le Zelda de Nintendo', { Zelda: 'Zeldà' }), 'Le Zeldà de Ninetendo');
  assert.strictEqual(preparer('iPhone et Gemini', null, { dictionnaire: false }), 'iPhone et Gemini', 'les voix en ligne n\'ont pas besoin du dictionnaire');
  assert.strictEqual(preparer('non ; oui (peut-être) fin'), 'non, oui, peut-être, fin');
});

// --- Moteurs de voix ------------------------------------------------------------------------------------------------------

test('voix : VOIX_MOTEUR choisit le moteur ; plusieurs moteurs = repli dans l\'ordre', () => {
  assert.deepStrictEqual(configuration({}).chaine, ['piper']);
  assert.deepStrictEqual(configuration({ VOIX_MOTEUR: 'azure,piper' }).chaine, ['azure', 'piper']);
  assert.deepStrictEqual(configuration({ VOIX_MOTEUR: ' Kokoro ' }).chaine, ['kokoro']);
  const c = configuration({ VOIX_MOTEUR: 'inconnu' });
  assert.deepStrictEqual([c.chaine, c.inconnus], [['piper'], ['inconnu']]);
});

test('voix : une voix réentraînée pour un autre moteur est détectée (Piper 2023 plante dessus)', () => {
  const d = tmp();
  const f = path.join(d, 'v.onnx.json');
  fs.writeFileSync(f, JSON.stringify({ phoneme_id_map: { a: [1], 'b': [2] } }));
  assert.strictEqual(modeleCompatible(f), true);
  fs.writeFileSync(f, JSON.stringify({ phoneme_id_map: { a: [1], 'aɪ': [2] } }));
  assert.strictEqual(modeleCompatible(f), false);
  assert.strictEqual(modeleCompatible(path.join(d, 'absent.json')), false);
});

test('voix : si le premier moteur échoue, tout le brief est refait avec le suivant', { skip: sansFfmpeg }, async () => {
  const d = tmp();
  const voix = creerVoix(d, { env: { VOIX_MOTEUR: 'azure,piper' }, journal: () => {} });
  const vus = [];
  const bonne = fausseVoix();
  voix.moteurs[0].synthetiser = async (t, w) => { vus.push(['azure', t]); if (vus.length > 1) throw new Error('quota dépassé'); await bonne(t, w); };
  voix.moteurs[1].synthetiser = async (t, w) => { vus.push(['piper', t]); await bonne(t, w); };
  const m = await voix.fabriquer({ date: '2026-11-05', chapitres: [{ titre: 'A', voix: 'Bonjour, iPhone.' }, { titre: 'B', voix: 'Deuxième chapitre.' }], dossierAudio: path.join(d, 'audio') });
  assert.deepStrictEqual(vus.map((v) => v[0]), ['azure', 'azure', 'piper', 'piper'], 'les deux chapitres refaits avec Piper : jamais deux voix dans un brief');
  assert.match(m.voix, /Piper/);
  assert.strictEqual(vus[0][1], 'Bonjour, iPhone.', 'Azure reçoit le texte sans respelling');
  assert.match(vus[2][1], /aïfone/, 'Piper reçoit les sigles et mots anglais écrits à la française');
  assert.ok(fs.existsSync(path.join(d, 'audio', '2026-11-05.mp3')) && fs.existsSync(path.join(d, 'audio', '2026-11-05.json')));
  // tout échoue : l'erreur remonte (audio.js la transforme en message lisible)
  voix.moteurs[1].synthetiser = async () => { throw new Error('Piper plante'); };
  await assert.rejects(voix.fabriquer({ date: '2026-11-06', chapitres: [{ titre: 'A', voix: 'x' }], dossierAudio: path.join(d, 'audio') }), /Piper plante/);
  assert.ok(!fs.existsSync(path.join(d, 'audio', '2026-11-06.mp3')));
});

test('azure : SSML sûr, clé jamais dans les erreurs, repli possible, rien d\'envoyé sans configuration', async () => {
  const ssml = azure.construireSsml('Il a dit "oui" & <script>x</script>.\nDeuxième phrase.', 'fr-FR-VivienneMultilingualNeural', 1);
  assert.ok(ssml.includes('&amp;') && ssml.includes('&lt;script&gt;') && ssml.includes('&quot;oui&quot;'));
  assert.ok(!ssml.includes('<script>'));
  assert.ok(ssml.includes('<break time="300ms"/>') && ssml.includes('name="fr-FR-VivienneMultilingualNeural"'));
  assert.deepStrictEqual(azure.decouper('a\n'.repeat(3000)).map((m) => m.length < 3600), [true, true]);

  const appels = [];
  const faux = (statut) => async (url, opts) => { appels.push({ url, opts }); return { ok: statut === 200, status: statut, arrayBuffer: async () => new ArrayBuffer(8), text: async () => 'clé ' + opts.headers['Ocp-Apim-Subscription-Key'] + ' refusée' }; };
  const d = tmp();
  const sans = azure.creer({ dossierDonnees: d, env: {}, journal: () => {}, fetchImpl: faux(200) });
  await assert.rejects(sans.synthetiser('Bonjour.', path.join(d, 'x.wav')), /manquant/);
  assert.strictEqual(appels.length, 0, 'sans clé, rien ne part');

  const env = { AZURE_SPEECH_KEY: 'cle-secrete-123', AZURE_SPEECH_REGION: 'francecentral' };
  const bon = azure.creer({ dossierDonnees: d, env, journal: () => {}, fetchImpl: faux(200) });
  await bon.synthetiser('Bonjour.', path.join(d, 'ok.wav'));
  assert.strictEqual(appels[0].url, 'https://francecentral.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.strictEqual(appels[0].opts.headers['X-Microsoft-OutputFormat'], 'riff-24khz-16bit-mono-pcm');
  assert.ok(fs.existsSync(path.join(d, 'ok.wav')));

  const refuse = azure.creer({ dossierDonnees: d, env, journal: () => {}, fetchImpl: faux(401) });
  const err = await refuse.synthetiser('Bonjour.', path.join(d, 'non.wav')).catch((e) => e);
  assert.match(err.message, /401/);
  assert.ok(!err.message.includes('cle-secrete-123'), 'la clé n\'apparaît jamais dans un message d\'erreur');
  assert.strictEqual(appels.length, 2, 'une clé refusée n\'est pas réessayée');
});

// --- Interface : pas d'émojis, accessibilité de base ----------------------------------------------------------------------

test('interface : aucun émoji ni symbole-émoji (icônes SVG partout)', () => {
  const emoji = /[\p{Extended_Pictographic}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u2713\u2714\u2190-\u2193\u23EE\u23ED]/u;
  for (const f of ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.json']) {
    const texte = fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');
    const trouve = texte.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => emoji.test(l.replace(/\/\/.*$/, ''))).map(([i, l]) => `${f}:${i} ${l.trim().slice(0, 60)}`);
    assert.deepStrictEqual(trouve, [], 'émoji trouvé');
  }
});

test('interface : chaque bouton a un nom, les icônes sont décoratives, pas de style en ligne (CSP)', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace(/<svg class="sprite"[\s\S]*?<\/svg>\s*<a class="evitement"/, '<a class="evitement"');
  for (const [, attrs, contenu] of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    const texte = contenu.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
    assert.ok(/aria-label=/.test(attrs) || texte || /\shidden/.test(attrs), `bouton sans nom : ${attrs}`); // (un bouton caché reçoit son texte du script)
  }
  for (const svg of html.matchAll(/<svg(?![^>]*sprite)([^>]*)>/g)) assert.match(svg[1], /aria-hidden="true"|class="ico"/, `icône non décorative : ${svg[0]}`);
  assert.ok(!/\sstyle="/.test(html), 'attribut style en ligne : bloqué par la politique de sécurité');
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /<nav aria-label=/);
});

test('voix : la voix par défaut change, mais sans accès à Internet on garde la voix Piper déjà installée', { skip: sansFfmpeg }, async () => {
  const d = tmp();
  const dossierPiper = path.join(d, 'piper');
  fs.mkdirSync(path.join(dossierPiper, 'piper'), { recursive: true });
  // Faux « piper » : un script qui écrit un son de test dans le fichier demandé.
  const faux = path.join(dossierPiper, 'piper', 'piper');
  fs.writeFileSync(faux, '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "--output_file" ] && S="$2"; shift; done\ncat >/dev/null\nexec ffmpeg -v error -y -f lavfi -i sine=frequency=440:duration=0.6 -ac 1 "$S"\n');
  fs.chmodSync(faux, 0o755);
  fs.mkdirSync(path.join(d, 'voix'));
  fs.writeFileSync(path.join(d, 'voix', 'fr_FR-siwis-medium.onnx'), 'x');
  fs.writeFileSync(path.join(d, 'voix', 'fr_FR-siwis-medium.onnx.json'), JSON.stringify({ phoneme_id_map: { a: [1] } }));
  fs.writeFileSync(path.join(d, 'voix', 'fr_FR-gilles-low.onnx'), 'x'); // incompatible : jamais choisie
  fs.writeFileSync(path.join(d, 'voix', 'fr_FR-gilles-low.onnx.json'), JSON.stringify({ phoneme_id_map: { 'aɪ': [1] } }));
  const vraiFetch = global.fetch;
  global.fetch = async () => { throw new Error('réseau coupé'); };
  const journal = [];
  try {
    const voix = creerVoix(d, { env: { PIPER_DIR: dossierPiper }, journal: (m) => journal.push(m) });
    await voix.installer();
    assert.strictEqual(voix.etat.prete, true, journal.join('\n'));
    assert.match(voix.etat.moteur, /siwis/);
    assert.ok(journal.some((m) => /on garde la voix déjà installée/.test(m)));
    // Une voix demandée explicitement n'est jamais remplacée en silence
    const stricte = creerVoix(d, { env: { PIPER_DIR: dossierPiper, VOIX_MODELE: 'fr_FR-tom-medium' }, journal: () => {} });
    await stricte.installer();
    assert.strictEqual(stricte.etat.prete, false);
    assert.match(stricte.etat.moteur, /tom/);
  } finally {
    global.fetch = vraiFetch;
  }
});

// --- Changer de voix : refaire les audios déjà prêts -----------------------------------------------------------------------

// Attend la fin d'un lot de fabrication : jusqu'à 5 minutes (un NAS lent met longtemps), sans compter un nombre de tours fixe.
const finDuLot = async (s) => { const limite = Date.now() + 300e3; while (s.audio.lot.enCours && Date.now() < limite) await new Promise((r) => setTimeout(r, 50)); };

test('refaire les audios avec la voix actuelle : sans toucher à Notion, l\'ancien reste lisible si ça échoue', { skip: sansFfmpeg }, async () => {
  const b = briefTest('2026-11-05');
  const vieux = briefTest('2026-11-04', { statut: 'Audio prêt' });
  const s = installer([b, vieux]);
  await s.audio.verifier(); // 05 : fabriqué avec la voix de test (ancienne voix)
  // le brief du 04 a déjà son audio, fait « avant » : on le simule en le fabriquant à la main
  await s.voix.fabriquer({ date: '2026-11-04', chapitres: [{ titre: 'A', voix: 'Ancien audio.' }], dossierAudio: s.audio.dossierAudio, moteur: fausseVoix(), meta: { mots: 100 } });
  const fabriqueAvant = s.audio.manifest('2026-11-05').fabrique;
  await new Promise((r) => setTimeout(r, 20));
  s.notion.appels.length = 0;
  s.log.length = 0;

  const demande = await requete(s, '/api/audio/refaire', { methode: 'POST', corps: {} });
  assert.strictEqual(demande.json.nombre, 2);
  assert.strictEqual((await requete(s, '/api/audio/refaire', { methode: 'POST', corps: {} })).status, 409, 'pas deux lots en même temps');
  await finDuLot(s);
  assert.strictEqual(s.audio.lot.enCours, false);
  assert.strictEqual(s.audio.lot.fait, 2);
  assert.ok(s.log.length >= 5, 'la voix a relu les chapitres des deux briefs');
  assert.ok(!s.notion.appels.some((a) => a.startsWith('ecriture') || a.startsWith('page ')), 'Notion n\'est pas touché (Statut et Audio (URL) restent)');
  assert.notStrictEqual(s.audio.manifest('2026-11-05').fabrique, fabriqueAvant, 'audio refait');
  assert.strictEqual(vieux.statut, 'Audio prêt');
  // un seul brief, une date invalide, un brief sans audio
  assert.strictEqual((await requete(s, '/api/audio/refaire', { methode: 'POST', corps: { date: '2026-11-05' } })).json.nombre, 1);
  await finDuLot(s);
  assert.strictEqual((await requete(s, '/api/audio/refaire', { methode: 'POST', corps: { date: '2026-11-30' } })).status, 404);
  assert.strictEqual((await requete(s, '/api/audio/refaire', { methode: 'POST', corps: { date: 'x' } })).status, 400);

  // si la nouvelle voix échoue, l'ancien audio reste en place et lisible
  const garde = fs.readFileSync(s.audio.fichier('2026-11-05', 'mp3'));
  const vrai = s.voix.fabriquer;
  s.voix.fabriquer = async () => { throw new Error('voix en panne'); };
  await requete(s, '/api/audio/refaire', { methode: 'POST', corps: { date: '2026-11-05' } });
  await finDuLot(s);
  s.voix.fabriquer = vrai;
  assert.ok(fs.readFileSync(s.audio.fichier('2026-11-05', 'mp3')).equals(garde));
  assert.strictEqual((await get(s, '/api/briefs/2026-11-05')).json.audio, true);
  // Réglages : combien d'audios sont faits avec une autre voix
  const r = (await get(s, '/api/reglages')).json;
  assert.strictEqual(r.audios.gardes, 2);
  assert.strictEqual(r.audios.autreVoix, 2, 'ils portent « voix de test », la voix actuelle est Piper');
});

test('interface : champs à 16 px (sinon Safari zoome), pas de zoom bloqué, zones sûres de l\'iPhone prises en compte', () => {
  const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
  assert.match(css, /input\[type=password\][^{]*\{\s*font-size: 1rem/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.ok(!/user-scalable=no|maximum-scale/.test(html), 'le zoom ne doit pas être bloqué (accessibilité)');
});
