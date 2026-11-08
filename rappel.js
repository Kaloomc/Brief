// Rappel du matin : une notification « Ton brief est prêt » (Web Push), à l'heure réglée, une fois par jour, dès que l'audio est prêt.
// La notification ne contient aucun texte du brief : le téléphone reçoit un « réveil » sans contenu (pas de chiffrement à gérer),
// et le service worker affiche toujours le même message. Les clés VAPID sont créées au premier lancement (data/vapid.json).
// Marche sur iPhone (iOS 16.4 ou plus) seulement quand l'appli est ajoutée à l'écran d'accueil.
const crypto = require('crypto');
const { parisDe } = require('./temps');

const b64u = (b) => Buffer.from(b).toString('base64url');

function creerRappel({ donnees, audio, urlPublique, fetchImpl = fetch, maintenant = () => new Date(), journal = console.log }) {
  function cles() {
    let k = donnees.lireSur('vapid.json', null);
    if (!k?.privee || !k?.publique) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = publicKey.export({ format: 'jwk' });
      k = {
        privee: privateKey.export({ format: 'pem', type: 'pkcs8' }),
        publique: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])),
      };
      donnees.ecrire('vapid.json', k);
    }
    return k;
  }

  // Jeton VAPID (RFC 8292) : ES256, valable 12 heures, pour le service de notifications du navigateur.
  function jeton(endpoint, k = cles()) {
    const sub = /^https:\/\//.test(urlPublique) ? urlPublique : 'mailto:brief@example.org';
    const corps = `${b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(maintenant().getTime() / 1000) + 12 * 3600, sub }))}`;
    const signature = crypto.sign('sha256', Buffer.from(corps), { key: k.privee, dsaEncoding: 'ieee-p1363' });
    return `${corps}.${b64u(signature)}`;
  }

  const abonnements = () => donnees.lireSur('abonnements.json', []);
  function abonner(s) {
    let url;
    try {
      url = new URL(s?.endpoint);
    } catch {
      throw Object.assign(new Error('Abonnement invalide.'), { status: 400 });
    }
    if (url.protocol !== 'https:') throw Object.assign(new Error('Abonnement invalide (adresse non sécurisée).'), { status: 400 });
    const liste = abonnements().filter((a) => a.endpoint !== url.href);
    liste.push({ endpoint: url.href, depuis: maintenant().toISOString() });
    donnees.ecrire('abonnements.json', liste.slice(-10));
  }
  function desabonner(endpoint) {
    donnees.ecrire('abonnements.json', abonnements().filter((a) => a.endpoint !== endpoint));
  }

  async function envoyer(abo) {
    const k = cles();
    const res = await fetchImpl(abo.endpoint, {
      method: 'POST',
      headers: { Authorization: `vapid t=${jeton(abo.endpoint, k)}, k=${k.publique}`, TTL: String(6 * 3600), Urgency: 'normal', 'Content-Length': '0' },
    });
    if (res.status === 404 || res.status === 410) desabonner(abo.endpoint); // abonnement périmé
    return res.status;
  }

  // À appeler chaque minute : envoie le rappel une fois par jour, quand l'heure est passée et que l'audio du jour est prêt.
  async function verifier() {
    const heure = donnees.reglages().rappel;
    if (!heure) return false;
    const p = parisDe(maintenant());
    const [h, m] = heure.split(':').map(Number);
    if (p.minutes < h * 60 + m || p.minutes > 12 * 60) return false;
    if (donnees.lireSur('rappel.json', {}).date === p.date) return false;
    if (!audio.manifest(p.date)) return false;
    const liste = abonnements();
    donnees.ecrire('rappel.json', { date: p.date }); // d'abord : jamais deux fois, même si l'envoi échoue en route
    let envoyes = 0;
    for (const a of liste) {
      try {
        if ((await envoyer(a)) < 300) envoyes++;
      } catch (err) {
        journal(`Rappel : envoi impossible : ${err.message}`);
      }
    }
    return envoyes > 0;
  }

  return { cles, jeton, abonner, desabonner, abonnements, envoyer, verifier, clePublique: () => cles().publique };
}

module.exports = { creerRappel };
