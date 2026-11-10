const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const donneesMod = require('./donnees');
const notionReel = require('./notion');
const demo = require('./demo');
const { creerVoix } = require('./voix');
const { creerAudio } = require('./audio');
const { creerRappel } = require('./rappel');
const { routeWidget } = require('./widget');
const planificateur = require('./planificateur');
const { pourLaVoix } = require('./nettoyage');
const { parisDe, dateValide, ajouterJours } = require('./temps');

// Construit l'appli. Tout ce qui touche au monde extérieur (Notion, voix, horloge, mot de passe) se passe en paramètre : les tests s'en servent.
function creerApp({
  dossier = process.env.DOSSIER_DONNEES || path.join(__dirname, 'data'),
  env = process.env,
  notion = env.NOTION_TOKEN ? notionReel : demo.creer(),
  voix = creerVoix(dossier),
  moteur,
  maintenant = () => new Date(),
  attentes,
  journal = console.log,
  fetchImpl,
} = {}) {
  const app = express();
  app.set('trust proxy', 1); // derrière le proxy inversé du NAS
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  const donnees = donneesMod.creer({ dossier, notion, maintenant });
  const urlPublique = env.URL_PUBLIQUE || `http://localhost:${env.PORT || 3014}`;
  const audio = creerAudio({ donnees, notion, voix, urlPublique, journal, maintenant, moteur, attentes });
  const rappel = creerRappel({ donnees, audio, urlPublique, journal, maintenant, fetchImpl });
  const mode = notion.demo ? 'demo' : 'notion';

  // En-têtes de sécurité : rien d'extérieur n'est chargé, aucun script en ligne ; les textes des briefs ne sont jamais du HTML.
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  // --- Mot de passe (obligatoire pour être joignable depuis le réseau) ------------------------------
  // Sans APP_PASSWORD, le serveur n'écoute que sur 127.0.0.1. Avec, l'API ET les fichiers audio demandent de se connecter
  // une fois ; un cookie garde la session un an. Les pages de l'appli elles-mêmes (HTML, CSS, JS) ne contiennent aucune donnée.
  const MOT_DE_PASSE = env.APP_PASSWORD;
  const signer = (s) => crypto.createHmac('sha256', s).update('brief').digest('hex');
  const jeton = MOT_DE_PASSE && signer(MOT_DE_PASSE);
  const egal = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const connecte = (req) => {
    if (!MOT_DE_PASSE) return true;
    const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)brief=([a-f0-9]+)/)?.[1] || '';
    return egal(cookie, jeton);
  };

  app.post('/api/connexion', async (req, res) => {
    if (!MOT_DE_PASSE) return res.json({ ok: true });
    const essai = String(req.body?.motDePasse ?? '');
    if (!egal(signer(essai), jeton)) {
      await new Promise((r) => setTimeout(r, 1000)); // freine les essais en série
      return res.status(401).json({ erreur: 'Mot de passe incorrect' });
    }
    res.setHeader('Set-Cookie', `brief=${jeton}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });

  // Widget iPhone : avant la connexion par cookie (il a son propre jeton), cache seulement, jamais Notion. Voir widget.js.
  app.get('/api/widget/brief', routeWidget({
    jeton: env.WIDGET_TOKEN,
    instantane: () => {
      const liste = donnees.listeEnCache();
      if (!liste) return null;
      const date = parisDe(maintenant()).date;
      const brief = liste.find((b) => b.date === date) ?? null;
      return { date, brief, audio: brief ? audio.manifest(date) : null };
    },
  }));

  app.get('/api/etat', (req, res) => res.json({ mode, motDePasse: !!MOT_DE_PASSE, connecte: connecte(req) }));

  app.use('/api', (req, res, next) => (connecte(req) ? next() : res.status(401).json({ erreur: 'Connexion nécessaire' })));

  // Les fichiers audio : même protection que l'API. Express gère les requêtes « Range » (206, Content-Range, 416),
  // indispensables à Safari et à iOS, et ETag / If-Range. Le fichier d'un jour peut être refait : on revalide à chaque fois.
  app.get('/audio/:fichier', (req, res, next) => {
    if (!connecte(req)) return res.status(401).end();
    const m = /^(\d{4}-\d{2}-\d{2})\.mp3$/.exec(req.params.fichier);
    if (!m || !dateValide(m[1]) || !audio.manifest(m[1])) return res.status(404).end();
    res.sendFile(`${m[1]}.mp3`, {
      root: audio.dossierAudio, acceptRanges: true, dotfiles: 'deny',
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-cache', 'Content-Disposition': `inline; filename="brief-${m[1]}.mp3"` },
    }, (err) => {
      // Un téléphone qui coupe la requête (Safari lit d'abord quelques octets, puis repart) n'est pas une erreur du serveur.
      if (err && !res.headersSent && err.code !== 'ECONNABORTED' && err.message !== 'Request aborted') next(err);
    });
  });

  app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

  // --- Briefs ---------------------------------------------------------------------------------------
  const erreur = (status, message) => Object.assign(new Error(message), { status });
  const arrondi1 = (x) => Math.round(x * 10) / 10;

  const horloge = () => {
    const p = parisDe(maintenant());
    return { date: p.date, heure: p.heure, minute: p.minute };
  };

  // Ce que l'écran a besoin de savoir d'un brief, sans son texte.
  function resume(b, progression) {
    const m = audio.manifest(b.date);
    const p = progression[b.date];
    return {
      date: b.date, titre: b.titre, statut: b.statut, sujets: b.sujets,
      dureeMin: m ? arrondi1(m.duree / 60) : b.dureeMin,
      audio: !!m, generation: audio.etatDe(b.date), audioExpire: b.date < ajouterJours(horloge().date, -donneesMod.JOURS_AUDIO),
      ecoute: !!p?.ecoute, position: p?.position ?? 0,
    };
  }
  app.get('/api/briefs', async (req, res) => {
    const l = await donnees.listerBriefs({ force: req.query.force === '1' });
    const progression = donnees.progression();
    const mots = donnees.sans(String(req.query.q ?? '')).split(/\s+/).filter(Boolean);
    const briefs = l.briefs
      .filter((b) => !mots.length || mots.every((mot) => donnees.sans(b.titre).includes(mot) || donnees.texteContient(b.date, mot)))
      .map((b) => resume(b, progression));
    res.json({ maintenant: horloge(), perime: l.perime, briefs });
  });

  app.get('/api/briefs/:date', async (req, res) => {
    const { date } = req.params;
    if (!dateValide(date)) throw erreur(400, 'Date invalide');
    let l = await donnees.listerBriefs();
    let brief = l.briefs.find((b) => b.date === date);
    if (!brief && !l.perime && date === horloge().date) { // le brief du jour vient peut-être d'être écrit : une relecture
      l = await donnees.listerBriefs({ force: true });
      brief = l.briefs.find((b) => b.date === date);
    }
    if (!brief) throw erreur(404, 'Pas de brief ce jour-là');

    let t = null;
    let texteIndisponible = null;
    try {
      t = await donnees.texte(brief);
    } catch (err) {
      t = donnees.texteEnCache(date);
      if (!t) texteIndisponible = `Le texte n'a pas pu être lu dans Notion (${err.message}).`;
    }
    const m = audio.manifest(date);
    // Les chapitres lus par la voix sont ceux qui ont du texte parlé, dans l'ordre : on leur rattache leur place dans l'audio.
    let k = 0;
    const chapitres = (t?.chapitres ?? []).map((c) => {
      const lu = pourLaVoix(c.texte) !== '';
      const a = lu && m ? m.chapitres[k] : null;
      if (lu) k++;
      return { titre: c.titre, texte: c.texte, voix: lu ? pourLaVoix(c.texte) : '', sources: c.sources, audio: a ? { debut: a.debut, duree: a.duree } : null };
    });
    const progression = donnees.progression()[date] ?? null;
    res.json({
      ...resume(brief, { [date]: progression }),
      maintenant: horloge(), perime: l.perime, texteIndisponible, chapitres, progression,
      audioInfo: m ? { url: `audio/${date}.mp3`, duree: m.duree, version: m.fabrique, chapitres: m.chapitres.map(({ titre, debut, duree }) => ({ titre, debut, duree })) } : null,
    });
  });

  app.put('/api/briefs/:date/progression', (req, res) => {
    const { date } = req.params;
    if (!dateValide(date)) throw erreur(400, 'Date invalide');
    const { position, duree, ecoute, maj } = req.body ?? {};
    if (!Number.isFinite(position) || position < 0 || position > 86400 || !Number.isFinite(duree) || duree < 0 || duree > 86400) throw erreur(400, 'Progression invalide');
    res.json(donnees.enregistrerProgression(date, { position, duree, ecoute: ecoute === true, maj: Number.isFinite(maj) ? maj : undefined }));
  });

  // « Réessayer l'audio » (la voix a échoué).
  app.post('/api/briefs/:date/audio', async (req, res) => {
    res.json(await audio.relancer(req.params.date));
  });

  // Changer de voix : refaire les audios déjà prêts avec la voix actuelle ({ date } : un seul ; sans date : ceux des 30 derniers jours).
  app.post('/api/audio/refaire', async (req, res) => {
    res.json(await audio.refaire(req.body?.date));
  });

  // --- Réglages et rappel ---------------------------------------------------------------------------
  const etatReglages = () => ({
    ...donnees.reglages(),
    rappelPossible: true, cleRappel: rappel.clePublique(), abonnes: rappel.abonnements().length,
    voix: { prete: voix.etat.prete, installation: voix.etat.installation, erreur: voix.etat.erreur, moteur: voix.etat.moteur, essaiMs: voix.etat.essaiMs ?? null, moteurs: voix.etat.moteurs },
    audios: { gardes: audio.audiosGardes().length, autreVoix: audio.audiosGardes().filter((a) => a.voix !== voix.etat.moteur).length, lot: { ...audio.lot } },
    mode, urlPublique,
  });
  app.get('/api/reglages', (req, res) => res.json(etatReglages()));
  app.put('/api/reglages', (req, res) => {
    donnees.enregistrerReglages(req.body ?? {});
    res.json(etatReglages());
  });
  app.post('/api/rappel/abonnement', (req, res) => {
    rappel.abonner(req.body);
    res.json({ ok: true });
  });
  app.delete('/api/rappel/abonnement', (req, res) => {
    rappel.desabonner(String(req.body?.endpoint ?? ''));
    res.json({ ok: true });
  });

  // --- Erreurs --------------------------------------------------------------------------------------
  app.use('/api', (req, res) => res.status(404).json({ erreur: 'Introuvable' }));
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) journal(err.stack || String(err));
    const message = status === 400 && err.type === 'entity.parse.failed' ? 'Requête illisible' : status >= 500 ? (/^Notion/.test(err.message) ? err.message : 'Erreur du serveur') : err.message;
    res.status(status >= 500 && /^Notion/.test(err.message) ? 502 : status).json({ erreur: message });
  });

  return { app, donnees, audio, voix, rappel, notion, mode, MOT_DE_PASSE, urlPublique };
}

module.exports = { creerApp };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3014;
  const s = creerApp();
  const pret = () => console.log(`Brief sur http://localhost:${PORT} (${s.mode === 'notion' ? 'Notion activé' : 'Notion non configuré : mode démo'})`);

  if (process.env.WIDGET_TOKEN && process.env.WIDGET_TOKEN.length < 32) console.warn('WIDGET_TOKEN trop court (32 caractères au minimum) : le widget est désactivé.');
  if (!process.env.URL_PUBLIQUE) console.warn(`URL_PUBLIQUE manquant : l'adresse écrite dans « Audio (URL) » sera http://localhost:${PORT}/audio/…`);

  s.audio.oublierAbandons();
  if (s.voix.config.auto || s.voix.installee()) s.voix.installer(); // télécharge Piper et la voix la première fois, sans bloquer le serveur
  // Vérification de la base Notion : toutes les 10 minutes de 6 h 30 à 10 h, puis toutes les heures.
  planificateur.demarrer(async () => {
    if (!s.voix.etat.prete && !s.voix.etat.installation && (s.voix.config.auto || s.voix.installee())) await s.voix.installer();
    if (s.voix.etat.installation) return;
    await s.audio.verifier();
  });
  setInterval(() => s.rappel.verifier().catch((err) => console.error('Rappel :', err.message)), 60e3).unref();

  if (s.MOT_DE_PASSE) s.app.listen(PORT, pret);
  else {
    console.warn('APP_PASSWORD manquant : Brief n’écoute que sur 127.0.0.1, il est injoignable depuis le réseau.');
    s.app.listen(PORT, '127.0.0.1', pret);
  }
}
