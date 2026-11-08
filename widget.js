// Widget iPhone (Scriptable) : GET /api/widget/brief — mêmes règles que les widgets de Repax et d'Argenx.
// Lecture seule, du cache seulement (jamais d'appel à Notion), sans cookie : le jeton WIDGET_TOKEN passé en
// « Authorization: Bearer … » (comparé en temps constant). Sans WIDGET_TOKEN d'au moins 32 caractères, la route n'existe pas.
// Débit : 60 requêtes par heure avec le bon jeton, 20 essais ratés par heure et par adresse.
const crypto = require('crypto');

// Fenêtre fixe : au plus `max` appels par `duree` ms et par clé. Renvoie 0 si c'est bon, sinon les secondes à attendre.
function limiteur(max, duree) {
  const compteurs = new Map();
  return (cle, maintenant = Date.now()) => {
    for (const [k, c] of compteurs) if (c.fin <= maintenant) compteurs.delete(k);
    const c = compteurs.get(cle) ?? { n: 0, fin: maintenant + duree };
    compteurs.set(cle, c);
    return ++c.n <= max ? 0 : Math.ceil((c.fin - maintenant) / 1000);
  };
}
const empreinte = (s) => crypto.createHash('sha256').update(String(s)).digest();

// `instantane()` : { date: 'AAAA-MM-JJ' du jour, brief: {...} ou null } ou null si la liste n'est pas encore chargée.
function construire({ date, brief, audio }) {
  return {
    date: brief?.date ?? date,
    title: brief?.titre ?? null,
    durationMin: audio ? Math.round(audio.duree / 6) / 10 : (brief?.dureeMin ?? null),
    ready: !!audio,
    chaptersCount: audio?.chapitres.length ?? 0,
  };
}

function routeWidget({ jeton, instantane, parHeure = 60, echecsParHeure = 20 }) {
  const actif = typeof jeton === 'string' && jeton.length >= 32;
  const attendu = actif && empreinte(jeton);
  const limiteReussites = limiteur(parHeure, 3600e3);
  const limiteEchecs = limiteur(echecsParHeure, 3600e3);
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!actif) return res.status(404).end();
    const fourni = (req.headers.authorization || '').match(/^Bearer (\S+)$/i)?.[1];
    if (!fourni || !crypto.timingSafeEqual(empreinte(fourni), attendu)) {
      const attente = limiteEchecs(req.ip);
      if (attente) return res.status(429).set('Retry-After', String(attente)).end();
      return res.status(401).set('WWW-Authenticate', 'Bearer').end();
    }
    const attente = limiteReussites('jeton');
    if (attente) return res.status(429).set('Retry-After', String(attente)).json({ erreur: 'Trop de requêtes' });
    const inst = instantane();
    if (!inst) return res.status(503).set('Retry-After', '30').json({ erreur: "Pas encore de données : l'appli vient de démarrer" });
    res.json(construire(inst));
  };
}

module.exports = { construire, routeWidget, limiteur };
