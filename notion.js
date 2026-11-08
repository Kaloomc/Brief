// Liens avec Notion (API officielle, https://developers.notion.com), même accès que Repax, Agendix et Argenx.
// NOTION_TOKEN   : jeton de l'intégration Notion (reste sur le serveur)
// NOTION_PAGE_ID : la page Notion commune (« Gestion »). La base « Brief du matin » est une base de cette page :
//                  on la retrouve par son titre, comme les autres applis retrouvent les leurs.
// NOTION_BASE_BRIEF (facultatif) : identifiant ou lien de la base, si on ne veut pas la chercher par son titre.
//
// Brief LIT les pages (liste sans le corps, puis le corps d'un brief à la fois) et n'ÉCRIT que deux propriétés
// d'une page : « Audio (URL) » et « Statut » (→ « Audio prêt »). Jamais le contenu d'une page, jamais une autre base.
const { blocsDepuisNotion } = require('./parseur');

const VERSION = '2022-06-28';
const TITRE_BASE = 'Brief du matin';
const STATUT_SCRIPT = 'Script prêt';
const STATUT_AUDIO = 'Audio prêt';

const token = () => process.env.NOTION_TOKEN;
const identifiant = (s) => (s || '').match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Notion accepte environ 3 requêtes par seconde : on les espace de 340 ms.
let prochain = 0;
const tour = () => {
  const t = Math.max(Date.now(), prochain);
  prochain = t + 340;
  return pause(t - Date.now());
};

async function api(method, chemin, body) {
  for (let essai = 0; ; essai++) {
    await tour();
    const res = await fetch('https://api.notion.com/v1' + chemin, {
      method,
      headers: { Authorization: `Bearer ${token()}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && essai < 4) {
      await pause((Number(res.headers.get('retry-after')) || 1) * 1000);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Notion : ${data.message || res.status}`);
    return data;
  }
}

let base = null; // promesse de l'identifiant de la base, gardée en mémoire ; absente ou en erreur : on la cherche de nouveau
async function trouverBase() {
  const direct = identifiant(process.env.NOTION_BASE_BRIEF);
  if (direct) return direct;
  const pageId = identifiant(process.env.NOTION_PAGE_ID);
  if (!pageId) throw new Error('NOTION_PAGE_ID manquant : indique la page Notion commune (« Gestion »).');
  let curseur;
  do {
    const r = await api('GET', `/blocks/${pageId}/children?page_size=100${curseur ? `&start_cursor=${curseur}` : ''}`);
    const b = r.results.find((x) => x.type === 'child_database' && x.child_database.title === TITRE_BASE);
    if (b) return b.id;
    curseur = r.next_cursor;
  } while (curseur);
  throw new Error(`Notion : la base « ${TITRE_BASE} » n'est pas dans la page indiquée par NOTION_PAGE_ID (ou l'intégration n'y a pas accès).`);
}
const getBase = () => (base ??= trouverBase().catch((err) => {
  base = null;
  throw err;
}));

const texte = (p) => (p?.[p?.type] ?? []).map((t) => t.plain_text).join('');

// Une page de la base, sans son corps.
function lireProprietes(page) {
  const p = page.properties || {};
  const creeLe = page.created_time ? new Date(page.created_time) : null;
  return {
    id: page.id,
    titre: texte(p['Titre']) || 'Brief sans titre',
    date: p['Date']?.date?.start?.slice(0, 10) || null, // sans date : l'appli prendra le jour de création (voir donnees.js)
    cree: creeLe && !Number.isNaN(creeLe.getTime()) ? creeLe.toISOString() : null,
    modifie: page.last_edited_time || null,
    statut: p['Statut']?.select?.name ?? null,
    audioUrl: p['Audio (URL)']?.url || null,
    mots: Number.isFinite(p['Nombre de mots']?.number) ? p['Nombre de mots'].number : null,
    dureeMin: Number.isFinite(p['Durée estimée (min)']?.number) ? p['Durée estimée (min)'].number : null,
    sujets: (p['Sujets']?.multi_select || []).map((s) => s.name),
  };
}

// Les briefs les plus récents d'abord : UNE seule requête, sans le corps des pages (100 briefs au plus, soit plus de trois mois).
async function listerBriefs() {
  const id = await getBase();
  const r = await api('POST', `/databases/${id}/query`, { page_size: 100, sorts: [{ property: 'Date', direction: 'descending' }] });
  return r.results.filter((p) => !p.archived && !p.in_trash).map(lireProprietes);
}

// Le corps d'une page (blocs de premier niveau), déjà au format de parseur.analyser().
async function lireCorps(pageId) {
  const blocs = [];
  let curseur;
  do {
    const r = await api('GET', `/blocks/${pageId}/children?page_size=100${curseur ? `&start_cursor=${curseur}` : ''}`);
    blocs.push(...r.results);
    curseur = r.next_cursor;
  } while (curseur);
  return blocsDepuisNotion(blocs);
}

// Les propriétés à jour d'une page : sert à vérifier, juste avant d'écrire, que le script n'a pas changé pendant la fabrication de l'audio.
async function lirePage(pageId) {
  return lireProprietes(await api('GET', `/pages/${pageId}`));
}

// LA SEULE ÉCRITURE DE L'APPLI : l'adresse de l'audio et le statut « Audio prêt ».
async function marquerAudioPret(pageId, url) {
  const page = await api('PATCH', `/pages/${pageId}`, {
    properties: {
      'Audio (URL)': { url },
      'Statut': { select: { name: STATUT_AUDIO } },
    },
  });
  return lireProprietes(page);
}

module.exports = {
  actif: () => !!token(), listerBriefs, lireCorps, lirePage, marquerAudioPret, lireProprietes,
  STATUT_SCRIPT, STATUT_AUDIO, TITRE_BASE, _reinitialiser: () => { base = null; },
};
