// Kokoro-82M (licence Apache 2.0), version ONNX : voix locale plus naturelle que Piper mais plus lourde
// (mesuré : 1,4 fois la vitesse de l'écoute sur un cœur d'un PC portable, 650 Mo de mémoire).
// Python (venv créé dans data/kokoro) fait tourner le modèle ; Brief ne fait qu'appeler outils/kokoro_synth.py.
// Une seule voix française : ff_siwis. Installation au premier lancement (environ 400 Mo : modèle, voix, bibliothèques).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { lancer, telecharger } = require('./commun');

const RELEASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
const PAQUET = 'kokoro-onnx==0.6.1'; // la version essayée

function creer({ dossierDonnees, env = process.env, journal = console.log }) {
  const dossier = env.KOKORO_DIR || path.join(dossierDonnees, 'kokoro');
  const cfg = {
    dossier, venv: path.join(dossier, 'venv'), python: path.join(dossier, 'venv', 'bin', 'python'),
    modele: path.join(dossier, 'kokoro-v1.0.onnx'), voixBin: path.join(dossier, 'voices-v1.0.bin'),
    voix: env.KOKORO_VOIX || 'ff_siwis', vitesse: Number(env.KOKORO_VITESSE) || 1,
    script: path.join(__dirname, '..', 'outils', 'kokoro_synth.py'),
  };
  const etat = { prete: false, installation: false, erreur: null, essaiMs: null };
  const libelle = `Kokoro ${cfg.voix}`;
  const fichiersPresents = () => fs.existsSync(cfg.python) && fs.existsSync(cfg.modele) && fs.existsSync(cfg.voixBin);

  function synthetiser(texte, wav) {
    return new Promise((resolve, reject) => {
      const p = spawn(cfg.python, [cfg.script, cfg.modele, cfg.voixBin, cfg.voix, String(cfg.vitesse), wav], { stdio: ['pipe', 'ignore', 'pipe'] });
      let erreurs = '';
      p.stderr.on('data', (d) => { erreurs = (erreurs + d).slice(-3000); });
      const minuteur = setTimeout(() => p.kill('SIGKILL'), 30 * 60e3);
      p.on('error', (err) => { clearTimeout(minuteur); reject(new Error(`Kokoro ne démarre pas : ${err.message}`)); });
      p.on('close', (code) => {
        clearTimeout(minuteur);
        if (code === 0 && fs.existsSync(wav)) resolve();
        else reject(new Error(`Kokoro a échoué (code ${code}) : ${erreurs.trim().split('\n').slice(-2).join(' | ')}`));
      });
      p.stdin.on('error', () => {});
      p.stdin.end(texte);
    });
  }

  async function verifier() {
    const essai = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-essai-'));
    try {
      const t0 = Date.now();
      await synthetiser('Bonjour, ceci est un essai de la voix.', path.join(essai, 'essai.wav'));
      etat.essaiMs = Date.now() - t0;
      etat.prete = true;
    } finally {
      fs.rmSync(essai, { recursive: true, force: true });
    }
  }

  async function installer() {
    etat.installation = true;
    try {
      if (!fichiersPresents()) {
        fs.mkdirSync(cfg.dossier, { recursive: true });
        if (!fs.existsSync(cfg.python)) {
          journal('Kokoro : création de l\'environnement Python (python3 et python3-venv doivent être installés)…');
          await lancer('python3', ['-m', 'venv', cfg.venv]);
          await lancer(path.join(cfg.venv, 'bin', 'pip'), ['install', '--quiet', '--no-cache-dir', PAQUET, 'soundfile', 'numpy'], { timeout: 30 * 60e3 });
        }
        if (!fs.existsSync(cfg.modele)) await telecharger(`${RELEASE}/kokoro-v1.0.onnx`, cfg.modele, journal);
        if (!fs.existsSync(cfg.voixBin)) await telecharger(`${RELEASE}/voices-v1.0.bin`, cfg.voixBin, journal);
      }
      await verifier();
      etat.erreur = null;
      journal(`Voix prête : ${libelle}`);
    } catch (err) {
      etat.prete = false;
      etat.erreur = err.message;
      journal(`Voix indisponible (${libelle}) : ${err.message}`);
    } finally {
      etat.installation = false;
    }
  }

  return { id: 'kokoro', libelle, etat, config: cfg, phonetique: true, installee: fichiersPresents, installer, verifier, synthetiser };
}

module.exports = { creer };
