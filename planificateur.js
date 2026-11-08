// Quand vérifier la base Notion : toutes les 10 minutes de 6 h 30 à 10 h (heure de Paris), puis toutes les heures pile.
const { parisDe } = require('./temps');

const DEBUT_MATIN = 6 * 60 + 30; // 6 h 30
const FIN_MATIN = 10 * 60;       // 10 h (incluse)

// Prochain instant de vérification strictement après `maintenant` : { quand: Date, minutes } (minutes depuis minuit, heure de Paris).
function prochaineVerification(maintenant = new Date()) {
  const p = parisDe(maintenant);
  const depuisMinuit = p.minutes + p.seconde / 60;
  let cible = null;
  // Créneaux de la journée (en minutes depuis minuit) : le matin toutes les 10 minutes, le reste toutes les heures.
  const creneaux = [];
  for (let m = 0; m < 24 * 60; m += 60) if (m < DEBUT_MATIN || m > FIN_MATIN) creneaux.push(m);
  for (let m = DEBUT_MATIN; m <= FIN_MATIN; m += 10) creneaux.push(m);
  creneaux.sort((a, b) => a - b);
  cible = creneaux.find((m) => m > depuisMinuit + 1e-9);
  const attenteMin = cible === undefined ? 24 * 60 - depuisMinuit + creneaux[0] : cible - depuisMinuit;
  return { quand: new Date(maintenant.getTime() + attenteMin * 60e3), minutes: cible ?? creneaux[0] };
}

// Lance `tache` aux heures voulues. Renvoie une fonction qui arrête le planning.
function demarrer(tache, { maintenant = () => new Date(), premier = 20e3 } = {}) {
  let minuteur;
  let arrete = false;
  const suivant = () => {
    if (arrete) return;
    const { quand } = prochaineVerification(maintenant());
    // Le délai ne dépasse jamais 1 heure : si l'heure change (heure d'été) ou si le NAS s'endort, on se recale à la fois suivante.
    minuteur = setTimeout(async () => {
      try { await tache(); } catch (err) { console.error('Vérification :', err); }
      suivant();
    }, Math.max(1000, Math.min(quand - maintenant(), 3600e3)));
    minuteur.unref?.();
  };
  const t0 = setTimeout(async () => {
    try { await tache(); } catch (err) { console.error('Vérification :', err); }
  }, premier);
  t0.unref?.();
  suivant();
  return () => { arrete = true; clearTimeout(minuteur); clearTimeout(t0); };
}

module.exports = { prochaineVerification, demarrer, DEBUT_MATIN, FIN_MATIN };
