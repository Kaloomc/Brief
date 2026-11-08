// Lit le contenu d'une page « Brief du matin » : une suite de chapitres,
//   ## Titre du chapitre
//   Texte parlé (un ou plusieurs paragraphes)
//   Sources :
//   - [Titre de l'article](https://...)
// Le parseur est tolérant : titres de chapitres libres, chapitre sans sources, sources sans lien,
// texte avant le premier titre, « Source : » au singulier, liste de sources sur une seule ligne…
// Tout ce qui sort d'ici est du texte brut : l'interface l'affiche avec textContent, jamais en HTML.
const { retirerMarkdown, pourLaVoix, compterMots } = require('./nettoyage');

// --- Blocs normalisés : { type: 'titre' | 'para' | 'puce', texte, liens: [{ texte, url }] } ----------------

const TITRES = new Set(['heading_1', 'heading_2', 'heading_3']);
const PARAGRAPHES = new Set(['paragraph', 'quote', 'callout', 'toggle']);
const PUCES = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do']);

// Blocs renvoyés par l'API Notion (GET /blocks/{id}/children). Les autres types (code, image, séparateur…) sont ignorés.
function blocsDepuisNotion(blocs) {
  const out = [];
  for (const b of blocs || []) {
    const type = b?.type;
    const riche = b?.[type]?.rich_text;
    if (!Array.isArray(riche)) continue;
    const texte = riche.map((r) => r.plain_text ?? r.text?.content ?? '').join('');
    const liens = riche.filter((r) => r.href || r.text?.link?.url).map((r) => ({ texte: r.plain_text ?? r.text?.content ?? '', url: r.href || r.text.link.url }));
    if (TITRES.has(type)) out.push({ type: 'titre', texte, liens });
    else if (PUCES.has(type)) out.push({ type: 'puce', texte, liens });
    else if (PARAGRAPHES.has(type)) out.push({ type: 'para', texte, liens });
  }
  return out;
}

// Même chose à partir de Markdown (tests, ou texte collé à la main).
function blocsDepuisMarkdown(md) {
  const out = [];
  for (const ligne of String(md ?? '').replace(/\r/g, '').split('\n')) {
    if (!ligne.trim()) continue;
    const liens = [];
    const brut = ligne.replace(/!?\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (m, texte, url) => {
      if (!m.startsWith('!')) liens.push({ texte, url });
      return m.startsWith('!') ? '' : texte;
    });
    let m;
    if ((m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(brut))) out.push({ type: 'titre', texte: retirerMarkdown(m[1]).trim(), liens });
    else if ((m = /^\s*(?:[-*+•]|\d+[.)])\s+(.*)$/.exec(brut))) out.push({ type: 'puce', texte: retirerMarkdown(m[1]).trim(), liens });
    else if (/^\s*(?:[-*_]{3,}|```.*)\s*$/.test(brut)) continue;
    else out.push({ type: 'para', texte: retirerMarkdown(brut).trim(), liens });
  }
  return out;
}

// --- Sources -----------------------------------------------------------------------------------------

const ENTETE_SOURCES = /^\W*sources?\W*$/i;                // « Sources : », « **Sources** », « Source »
const SOURCES_EN_LIGNE = /^\W*sources?\s*:\s*(.+)$/i;      // « Sources : Public Sénat, Le Monde »

const urlSure = (u) => {
  try {
    const url = new URL(String(u).trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};
const site = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// « Titre de l'article (Public Sénat) » → site = « Public Sénat » ; sinon le nom de domaine.
function creerSource(texte, url) {
  let titre = String(texte || '').replace(/\s+/g, ' ').trim();
  const sure = url ? urlSure(url) : null;
  let nom = '';
  const m = /^(.*\S)\s*\(([^()]{2,60})\)\s*$/.exec(titre);
  if (m) {
    titre = m[1];
    nom = m[2].trim();
  }
  if (!titre) titre = nom || (sure ? site(sure) : '');
  if (!titre) return null;
  return { titre: titre.slice(0, 300), url: sure, site: nom || (sure ? site(sure) : '') };
}

function sourcesDeBloc(b, texteApresEntete) {
  const liens = b.liens.filter((l) => urlSure(l.url));
  if (liens.length) {
    // Plusieurs liens sur une ligne : une source par lien. Un seul lien : le texte de la ligne (titre complet, site entre parenthèses).
    if (liens.length === 1) return [creerSource(texteApresEntete ?? b.texte, liens[0].url)].filter(Boolean);
    return liens.map((l) => creerSource(l.texte, l.url)).filter(Boolean);
  }
  const t = texteApresEntete ?? b.texte;
  // Sans lien : « Notion » est une source sans adresse ; une liste séparée par des virgules ou points-virgules en fait plusieurs.
  const morceaux = b.type === 'puce' ? [t] : t.split(/\s*[;,]\s*/);
  return morceaux.map((x) => creerSource(x, null)).filter(Boolean);
}

// --- Chapitres ---------------------------------------------------------------------------------------

const nettoyerTitre = (t) => t.replace(/^\s*chapitre\s*\d+\s*[:.\-–—]\s*/i, '').replace(/\s*:\s*$/, '').replace(/\s+/g, ' ').trim();

// Renvoie { chapitres: [{ titre, texte, sources: [{ titre, url, site }] }], mots }.
// `texte` : paragraphes séparés par une ligne vide. Un chapitre sans texte ni sources est écarté.
function analyser(blocs) {
  const chapitres = [];
  let cour = null;
  let dansSources = false;
  let nbSources = 0;
  const ouvrir = (titre) => {
    cour = { titre, paragraphes: [], sources: [] };
    chapitres.push(cour);
    dansSources = false;
    nbSources = 0;
  };

  for (const b of blocs) {
    if (b.type === 'titre') {
      const titre = nettoyerTitre(b.texte);
      if (ENTETE_SOURCES.test(titre) && cour) { // un titre « Sources » dans le chapitre : même effet que la ligne « Sources : »
        dansSources = true;
        continue;
      }
      ouvrir(titre || 'Sans titre');
      continue;
    }
    const texte = b.texte.trim();
    if (!texte && !b.liens.length) continue;
    if (!cour) ouvrir('Introduction');

    if (b.type !== 'titre' && ENTETE_SOURCES.test(texte)) {
      dansSources = true;
      continue;
    }
    const enLigne = b.type === 'para' ? SOURCES_EN_LIGNE.exec(texte) : null;
    if (enLigne) {
      dansSources = true;
      const apres = enLigne[1];
      const liensApres = b.liens.filter((l) => apres.includes(l.texte));
      const s = sourcesDeBloc({ ...b, type: 'para', liens: liensApres }, apres);
      cour.sources.push(...s);
      nbSources += s.length;
      continue;
    }
    if (dansSources) {
      if (b.type === 'puce' || b.liens.length) {
        const s = sourcesDeBloc(b);
        cour.sources.push(...s);
        nbSources += s.length;
        continue;
      }
      // Un vrai paragraphe après la liste des sources : c'est du texte parlé, la liste est finie.
      if (nbSources > 0) dansSources = false;
      else continue; // texte juste sous « Sources : » sans lien ni puce : on l'ignore
    }
    cour.paragraphes.push(texte);
  }

  const resultat = chapitres
    .map((c) => ({ titre: c.titre, texte: c.paragraphes.join('\n\n'), sources: dedoublonner(c.sources) }))
    .filter((c) => c.texte || c.sources.length);
  const mots = resultat.reduce((n, c) => n + compterMots(pourLaVoix(c.texte)), 0);
  return { chapitres: resultat, mots };
}

function dedoublonner(sources) {
  const vus = new Set();
  return sources.filter((s) => {
    const k = `${s.url || ''}|${s.titre}`;
    return !vus.has(k) && vus.add(k);
  });
}

const analyserNotion = (blocs) => analyser(blocsDepuisNotion(blocs));
const analyserMarkdown = (md) => analyser(blocsDepuisMarkdown(md));

module.exports = { analyser, analyserNotion, analyserMarkdown, blocsDepuisNotion, blocsDepuisMarkdown, creerSource, urlSure };
