// Dates et heures de Paris, quel que soit le fuseau du serveur (le NAS est réglé sur Europe/Paris, mais on ne s'y fie pas).
const FUSEAU = 'Europe/Paris';
const format = new Intl.DateTimeFormat('sv-SE', {
  timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// { date: '2026-11-05', heure: 6, minute: 21, minutes: 381 } (minutes = minutes écoulées depuis minuit)
function parisDe(d = new Date()) {
  const p = Object.fromEntries(format.formatToParts(d).map((x) => [x.type, x.value]));
  const heure = Number(p.hour), minute = Number(p.minute);
  return { date: `${p.year}-${p.month}-${p.day}`, heure, minute, seconde: Number(p.second), minutes: heure * 60 + minute };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dateValide(s) {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function ajouterJours(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
// « jeudi 5 novembre »
function dateLisible(date) {
  const d = new Date(date + 'T12:00:00Z');
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
}

module.exports = { FUSEAU, parisDe, dateValide, ajouterJours, dateLisible };
