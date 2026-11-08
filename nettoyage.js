// Prépare un texte pour la voix : plus de Markdown, d'adresses, d'émojis ni de symboles que la voix lirait mal.
// Ne s'applique qu'au texte parlé (les sources sont retirées avant, par parseur.js).

// Retire le Markdown d'un texte affiché ou lu : liens → leur texte, gras, italique, code, titres, puces, citations.
function retirerMarkdown(t) {
  return String(t)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')            // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')           // [texte](adresse) → texte
    .replace(/```[\s\S]*?```/g, ' ')                   // blocs de code
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')                // gras
    .replace(/(^|[\s(«"'])([*_])(?=\S)(.+?)(?<=\S)\2(?=$|[\s).,;:!?»"'])/g, '$1$3') // italique
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')                // titres
    .replace(/^\s*>\s?/gm, '')                         // citations
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')        // puces
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ');              // filets
}

const EMOJIS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;
const ADRESSES = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>()\]]*/gi;

function pourLaVoix(texte) {
  let t = String(texte ?? '').normalize('NFC');
  t = retirerMarkdown(t);
  t = t.replace(ADRESSES, ' ');
  t = t.replace(/<[^>]+>/g, ' ');                       // balises HTML éventuelles : jamais lues
  t = t.replace(EMOJIS, ' ');

  // Montants et unités avant les symboles isolés
  t = t.replace(/(\d)\s*(?:Md|Mds)\s*€/g, '$1 milliards d’euros')
    .replace(/(\d)\s*M\s*€/g, '$1 millions d’euros')
    .replace(/(\d)\s*k\s*€/gi, '$1 mille euros')
    .replace(/€\s*(\d+(?:[.,]\d+)?)/g, '$1 euros')
    .replace(/\$\s*(\d+(?:[.,]\d+)?)/g, '$1 dollars')
    .replace(/£\s*(\d+(?:[.,]\d+)?)/g, '$1 livres')
    .replace(/€/g, ' euros ').replace(/\$/g, ' dollars ').replace(/£/g, ' livres ')
    .replace(/%/g, ' pour cent ')
    .replace(/‰/g, ' pour mille ')
    .replace(/°\s*C\b/g, ' degrés Celsius ').replace(/°\s*F\b/g, ' degrés Fahrenheit ')
    .replace(/\bn°\s*/gi, 'numéro ').replace(/№\s*/g, 'numéro ')
    .replace(/°/g, ' degrés ')
    .replace(/&/g, ' et ')
    .replace(/(^|[\s(])\+(?=\d)/g, '$1plus ')
    .replace(/[≈≃~](?=\s*\d)/g, ' environ ')
    .replace(/×/g, ' fois ')
    .replace(/[→⇒➜➔]/g, ', ')
    .replace(/[←⇐]/g, ', ')
    .replace(/\s*[|•·▪■□◆◇★☆✓✔✗✘]\s*/g, ' ')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, '’')
    .replace(/[   ]/g, ' ');

  // Ligne par ligne : une phrase finit toujours par un point (la voix marque alors la pause)
  const lignes = t.split(/\n+/).map((l) => l.replace(/[ \t]+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()).filter((l) => /[\p{L}\p{N}]/u.test(l));
  return lignes.map((l) => (/[.!?…:;»"]$/.test(l) ? l : l + '.')).join('\n');
}

const compterMots = (t) => (String(t).match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu) || []).length;

module.exports = { pourLaVoix, retirerMarkdown, compterMots };
