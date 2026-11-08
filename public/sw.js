// Service worker de Brief.
//  - Réseau d'abord, copie en cache en secours : le dernier brief ouvert (texte, sources) reste lisible sans réseau.
//  - L'audio en ligne n'est JAMAIS intercepté (Safari est exigeant sur les requêtes « Range » : on le laisse parler au serveur).
//  - Hors ligne seulement, l'appli lit /audio-cache/AAAA-MM-JJ.mp3 : on le sert depuis le fichier gardé par la page (cache « brief-audio »),
//    en découpant la réponse selon l'en-tête « Range », comme le ferait un serveur.
const CACHE = 'brief';
const CACHE_AUDIO = 'brief-audio';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function audioGarde(req) {
  const url = new URL(req.url);
  const reseau = new URL(url.pathname.replace('/audio-cache/', '/audio/') + url.search, url.origin).href;
  const cache = await caches.open(CACHE_AUDIO);
  const gardee = await cache.match(reseau);
  if (!gardee) return new Response('Audio non gardé hors ligne', { status: 404 });
  const octets = await gardee.arrayBuffer();
  const total = octets.byteLength;
  const entetes = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (!m || (m[1] === '' && m[2] === '')) return new Response(octets, { status: 200, headers: { ...entetes, 'Content-Length': String(total) } });
  let debut = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1]);
  let fin = m[1] === '' || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
  if (debut >= total || debut > fin) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  return new Response(octets.slice(debut, fin + 1), {
    status: 206, headers: { ...entetes, 'Content-Range': `bytes ${debut}-${fin}/${total}`, 'Content-Length': String(fin - debut + 1) },
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  const chemin = new URL(req.url).pathname;
  if (chemin.includes('/audio-cache/')) return e.respondWith(audioGarde(req));
  if (chemin.includes('/audio/') || chemin.includes('/api/widget/')) return; // réseau direct, sans copie
  e.respondWith(
    // no-cache : toujours revalider auprès du serveur (sinon une nouvelle version peut rester invisible).
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copie = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copie));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// Rappel du matin : le serveur envoie un « réveil » sans contenu ; le message affiché est toujours le même.
self.addEventListener('push', (e) => {
  e.waitUntil(self.registration.showNotification('Brief du matin', {
    body: 'Ton brief est prêt. Appuie pour l’écouter.',
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'brief-du-matin', data: { url: './#aujourdhui' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (fenetres.length) return fenetres[0].focus();
    return self.clients.openWindow(e.notification.data?.url || './');
  })());
});
