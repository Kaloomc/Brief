// Prononciation : prépare le texte (déjà passé par nettoyage.js) pour que la voix le lise « à la française ».
// Les liaisons courantes (les‿amis, des‿enfants, trois‿heures, six‿ans…) sont déjà bien phonétisées par le moteur
// (espeak-ng) : on ne les touche pas. Ce qui se lisait mal, mesuré phonème par phonème, c'est ce que corrige ce module :
//   - les nombres, heures, ordinaux et unités en chiffres (« 2e » → « deuxième », « 21 h » → « vingt et une heures »,
//     « 3 km/h » → « trois kilomètres-heure ») ;
//   - les sigles et les mots anglais (« l'IA », « iPhone », « Gemini », « Ocarina of Time ») : écrits comme ils se prononcent.
// Le dictionnaire de base est dans ce fichier ; le tien (data/prononciations.json, { "mot": "comme ça se prononce" })
// s'y ajoute et gagne en cas de doublon.

// --- Nombres en lettres ----------------------------------------------------------------------------

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const DIZAINES = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

// 0 à 99
function moinsDeCent(n) {
  if (n < 17) return UNITES[n];
  if (n < 20) return 'dix-' + UNITES[n - 10];
  if (n < 70) {
    const d = Math.floor(n / 10), u = n % 10;
    if (u === 0) return DIZAINES[d];
    return DIZAINES[d] + (u === 1 ? ' et un' : '-' + UNITES[u]);
  }
  if (n < 80) return 'soixante' + (n === 71 ? ' et onze' : '-' + moinsDeCent(n - 60));
  if (n === 80) return 'quatre-vingts';
  return 'quatre-vingt-' + moinsDeCent(n - 80); // 81 à 99
}

// 0 à 999 ; `fin` : le nombre termine l'expression (« deux cents » mais « deux cent un »)
function moinsDeMille(n, fin) {
  const c = Math.floor(n / 100), r = n % 100;
  let s = '';
  if (c > 0) s = (c === 1 ? 'cent' : UNITES[c] + ' cent') + (c > 1 && r === 0 && fin ? 's' : '');
  if (r > 0) s += (s ? ' ' : '') + moinsDeCent(r);
  return s;
}

function nombreEnLettres(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zéro';
  if (n >= 1e12) return String(n).split('').map((c) => UNITES[Number(c)]).join(' '); // trop grand : chiffre par chiffre
  const echelles = [[1e9, 'milliard'], [1e6, 'million']];
  const parts = [];
  let reste = n;
  for (const [valeur, nom] of echelles) {
    const q = Math.floor(reste / valeur);
    if (q > 0) {
      parts.push(`${nombreEnLettres(q)} ${nom}${q > 1 ? 's' : ''}`);
      reste %= valeur;
    }
  }
  const milliers = Math.floor(reste / 1000);
  reste %= 1000;
  if (milliers > 0) parts.push(milliers === 1 ? 'mille' : `${moinsDeMille(milliers, false)} mille`);
  if (reste > 0) parts.push(moinsDeMille(reste, true));
  // « quatre-vingts » perd son s devant un autre mot : « quatre-vingt mille », « quatre-vingt-un »
  return parts.join(' ').replace(/quatre-vingts (?!mille\b)(?=\S)/g, 'quatre-vingt ').replace(/quatre-vingts mille/g, 'quatre-vingt mille');
}

// « un » → « une » à la fin (heures, minutes…)
const auFeminin = (s) => s.replace(/\bun$/, 'une');

// Ordinaux : deuxième, quatrième, cinquième, neuvième, vingt et unième, centième…
function ordinal(n, feminin = false) {
  if (n === 1) return feminin ? 'première' : 'premier';
  let s = nombreEnLettres(n).replace(/ cents$/, ' cent').replace(/-vingts$/, '-vingt').replace(/(millions?|milliards?)$/, (m) => m.replace(/s$/, ''));
  if (/(^|\s|-)un$/.test(s) && n > 1) s = s + 'ième'; // « vingt et unième »
  else if (/e$/.test(s)) s = s.slice(0, -1) + 'ième';
  else if (/f$/.test(s)) s = s.slice(0, -1) + 'vième';
  else if (/q$/.test(s)) s += 'uième';
  else if (/[xs]$/.test(s)) s += 'ième'; // deuxième, troisième, sixième, dixième
  else s += 'ième';
  return s;
}

const ROMAINS = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function depuisRomain(r) {
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const v = ROMAINS[r[i]], suivant = ROMAINS[r[i + 1]] || 0;
    total += v < suivant ? -v : v;
  }
  return total;
}

// --- Mots et sigles --------------------------------------------------------------------------------
// « Comme ça se prononce », vérifié avec le moteur de la voix (espeak-ng) : chaque entrée donne le bon son en français.
const DICTIONNAIRE = {
  // Sigles (épelés)
  IA: 'I A', 'l’IA': 'l’I A', IAs: 'I A', GPT: 'Djé Pé Té', ChatGPT: 'Tchatte Djé Pé Té', GTA: 'Djé Té A', NBA: 'N B A', USA: 'U S A',
  PC: 'P C', TV: 'télé', SMS: 'S M S', QR: 'Q R', API: 'A P I', CPU: 'C P U', GPU: 'G P U', SSD: 'S S D', USB: 'U S B', NAS: 'N A S',
  // Mots anglais courants dans les actualités tech, jeux vidéo et sport
  iPhone: 'aïfone', iPad: 'aïpade', iOS: 'aïo-esse', macOS: 'mac-o-esse', iCloud: 'aï-claoude', Gemini: 'Djémini', OpenAI: 'Opène Aï',
  Anthropic: 'Antropique', Nvidia: 'Ène-vidia', Tesla: 'Tessla', Google: 'Gougueule', YouTube: 'Youtioube', TikTok: 'Tik-Tok',
  Instagram: 'Instagrame', Netflix: 'Nètflixe', Discord: 'Discorde', Twitch: 'Touitche', GitHub: 'Guite-Heub', Windows: 'Ouine-doze',
  Linux: 'Linuxe', Python: 'Pitone', Switch: 'Souitche', PlayStation: 'Pléï-Stéïchone', Xbox: 'Ex boxe', Steam: 'Stime', 'Wi-Fi': 'Ouifi', WiFi: 'Ouifi',
  Bluetooth: 'Blou-touse', Ocarina: 'Okarina', 'of Time': 'ove Taïme', Nintendo: 'Ninetendo', Fortnite: 'Fortenaïte',
  Minecraft: 'Maïne-craft', Pokémon: 'Pokémone', Warcraft: 'Ouore-craft', WoW: 'Waou', Forever: 'Foréveur', Carbon: 'Carbone', FlashProve: 'Flache-Prouve',
  Villarreal: 'Vi-ya-réal', Feyenoord: 'Féyénoorde', Manchester: 'Mantchestère', United: 'Younaïtède', Bodø: 'Bodeu', Atlético: 'Atlétiko', Cunha: 'Counia',
  Zaporijjia: 'Zaporijia', Ormuz: 'Ormouze',
};

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dictionnaire(perso) {
  return { ...DICTIONNAIRE, ...(perso && typeof perso === 'object' ? perso : {}) };
}

function appliquerDictionnaire(t, dico) {
  const mots = Object.keys(dico).sort((a, b) => b.length - a.length);
  if (!mots.length) return t;
  // Mot entier, en respectant les majuscules (« IA » ne touche pas « Pia », « of Time » ne touche pas « Time » seul).
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${mots.map(echapper).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  return t.replace(re, (m) => dico[m]);
}

// --- Nombres, heures, ordinaux, unités dans le texte -------------------------------------------------------

const UNITES_TEXTE = {
  'km/h': 'kilomètres-heure', km: 'kilomètres', kg: 'kilos', cm: 'centimètres', mm: 'millimètres', m: 'mètres', g: 'grammes',
  Go: 'gigaoctets', Mo: 'mégaoctets', To: 'téraoctets', Ko: 'kilooctets', GHz: 'gigahertz', MHz: 'mégahertz', kWh: 'kilowattheures', kW: 'kilowatts', MW: 'mégawatts', Hz: 'hertz',
};
const NOMBRE = String.raw`\d{1,3}(?:[   ]\d{3})+|\d+`;

function nombreDepuis(brut) {
  return Number(brut.replace(/[   ]/g, ''));
}

function chiffresEnLettres(t) {
  // Chiffres romains avec ordinal : « XXIe siècle »
  // (seulement devant un mot qui les appelle : « Le » n'est pas « cinquantième »)
  t = t.replace(/(?<![\p{L}\p{N}])([IVXLC]+)(er|ère|re|e|ème|eme)(?=\s+(?:siècle|millénaire|arrondissement|édition|dynastie|république|guerre|division|symphonie|acte|partie|chapitre)\b)/gu, (m, r, suf) => {
    const n = depuisRomain(r);
    return n > 0 && n < 400 ? ordinal(n, /^(ère|re)$/.test(suf)) : m;
  });
  // Ordinaux : 1er, 1re, 2e, 3ème
  t = t.replace(new RegExp(String.raw`(?<![\p{L}\p{N}])(\d+)(er|ère|re|e|ème|eme|es|èmes)(?![\p{L}\p{N}])`, 'gu'), (m, n, suf) =>
    ordinal(Number(n), /^(ère|re)$/.test(suf)) + (/s$/.test(suf) ? 's' : ''));
  // Heures : 7 h 30, 7h30, 21 h, 7 h 05
  t = t.replace(/(?<![\p{L}\p{N}.,])(\d{1,2})\s?h(?:\s?(\d{2}))?(?![\p{L}\p{N}])/gu, (m, h, mn) => {
    const heures = Number(h);
    if (heures > 24) return m;
    const mots = `${auFeminin(nombreEnLettres(heures))} heure${heures > 1 ? 's' : ''}`;
    return mn && mn !== '00' ? `${mots} ${nombreEnLettres(Number(mn))}` : mots;
  });
  // Nombre + unité : 3 km/h, 12 Go, 2,5 kg
  const unites = Object.keys(UNITES_TEXTE).sort((a, b) => b.length - a.length).map(echapper).join('|');
  t = t.replace(new RegExp(String.raw`(?<![\p{L}\p{N}])(${NOMBRE})(,\d+)?\s?(${unites})(?![\p{L}\p{N}/])`, 'gu'), (m, ent, dec, u) =>
    `${ent}${dec || ''} ${UNITES_TEXTE[u]}`);
  // Nombres décimaux : 3,5 → trois virgule cinq ; entiers : 1 250 000 → un million deux cent cinquante mille
  t = t.replace(new RegExp(String.raw`(?<![\p{L}\p{N}.,/-])(${NOMBRE})(?:,(\d{1,3}))?(?![\p{L}\p{N}])`, 'gu'), (m, ent, dec) => {
    const n = nombreDepuis(ent);
    if (!Number.isFinite(n) || n >= 1e12) return m;
    const entier = nombreEnLettres(n);
    if (dec === undefined) return entier;
    const zeros = dec.match(/^0*/)[0].length;
    return `${entier} virgule ${'zéro '.repeat(zeros)}${nombreEnLettres(Number(dec))}`.replace(/ zéro zéro$/, '');
  });
  return t;
}

// Rythme : une ponctuation simple que la voix suit bien (parenthèses, tirets, points-virgules → virgules).
function ponctuation(t) {
  return t
    .replace(/\s*[(\[]\s*([^()\[\]]{1,80}?)\s*[)\]]/g, ', $1,')
    .replace(/\s+[—–-]\s+/g, ', ')
    .replace(/;/g, ',')
    .replace(/…/g, '.')
    .replace(/[«»"]/g, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ');
}

// texte : sortie de nettoyage.pourLaVoix() (une phrase par ligne). perso : { mot: prononciation } (data/prononciations.json).
function preparer(texte, perso, { dictionnaire: avecDico = true } = {}) {
  const dico = avecDico ? dictionnaire(perso) : {};
  return String(texte ?? '')
    .split('\n')
    .map((ligne) => ponctuation(chiffresEnLettres(appliquerDictionnaire(ligne, dico))).trim())
    .filter((l) => /[\p{L}\p{N}]/u.test(l))
    .join('\n');
}

module.exports = { preparer, nombreEnLettres, ordinal, depuisRomain, DICTIONNAIRE, chiffresEnLettres, ponctuation };
