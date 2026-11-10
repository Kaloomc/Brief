// Outils communs aux moteurs de voix.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

// Lance un programme (sans shell) et renvoie sa sortie ; une erreur lisible sinon.
const lancer = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60e3, ...opts }, (err, stdout, stderr) => {
    if (err) reject(new Error(`${path.basename(cmd)} a échoué : ${(stderr || err.message).toString().trim().split('\n').slice(-3).join(' | ')}`));
    else resolve(stdout);
  });
});

async function telecharger(url, destination, journal) {
  journal(`Téléchargement : ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destination + '.part'));
  fs.renameSync(destination + '.part', destination);
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { lancer, telecharger, attendre };
