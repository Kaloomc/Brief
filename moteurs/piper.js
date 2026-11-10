// Piper (https://github.com/rhasspy/piper) : voix locale, légère (environ 10 fois plus rapide que l'écoute sur un cœur de PC portable).
// Le moteur (version 2023.11.14-2) et la voix sont téléchargés une fois dans data/piper et data/voix.
//
// ATTENTION, voix épinglées : le dépôt des voix évolue (le 9 novembre 2026, « siwis » a été réentraînée pour Piper 1.5 :
// son fichier de réglages fait planter ce moteur avec « Phonemes must be one codepoint »). On télécharge donc la révision
// VOIX_REVISION (« v1.0.0 » par défaut), jamais la branche « main ».
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { lancer, telecharger } = require('./commun');

const VERSION_PIPER = '2023.11.14-2';
const ARCHIVES = { x64: 'x86_64', arm64: 'aarch64', arm: 'armv7l' };
const REVISION_VOIX = 'v1.0.0';
const VOIX_DEFAUT = 'fr_FR-upmc-medium';

// « fr_FR-upmc-medium » → https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/upmc/medium/fr_FR-upmc-medium
function urlVoix(modele, revision = REVISION_VOIX) {
  const [lang, nom, qualite] = modele.split('-');
  return `https://huggingface.co/rhasspy/piper-voices/resolve/${revision}/${lang.split('_')[0]}/${lang}/${nom}/${qualite}/${modele}`;
}

// Un fichier de réglages « Piper 1.5 » contient des phonèmes de plusieurs caractères : ce moteur-ci ne sait pas les lire.
function modeleCompatible(fichierJson) {
  try {
    const d = JSON.parse(fs.readFileSync(fichierJson, 'utf8'));
    return !Object.keys(d.phoneme_id_map || {}).some((k) => [...k].length > 1);
  } catch {
    return false;
  }
}

function creer({ dossierDonnees, env = process.env, journal = console.log }) {
  const modele = env.VOIX_MODELE || VOIX_DEFAUT;
  const dossierPiper = env.PIPER_DIR || path.join(dossierDonnees, 'piper');
  const cfg = {
    dossierPiper, piper: path.join(dossierPiper, 'piper', 'piper'), modele,
    fichierModele: path.join(dossierDonnees, 'voix', `${modele}.onnx`),
    revision: env.VOIX_REVISION || REVISION_VOIX,
    locuteur: env.VOIX_LOCUTEUR !== undefined && env.VOIX_LOCUTEUR !== '' ? Number(env.VOIX_LOCUTEUR) : (modele === VOIX_DEFAUT ? 1 : null),
    bruit: env.PIPER_NOISE_SCALE ? Number(env.PIPER_NOISE_SCALE) : null,
    bruitW: env.PIPER_NOISE_W ? Number(env.PIPER_NOISE_W) : null,
    vitesseVoix: Number(env.PIPER_LENGTH_SCALE) || 1, // < 1 : plus rapide
  };
  const etat = { prete: false, installation: false, erreur: null, essaiMs: null };
  const nomVoix = () => `Piper ${cfg.modele}${cfg.locuteur != null ? ` (voix ${cfg.locuteur})` : ''}`;
  let libelle = nomVoix();
  const voixParDefaut = !env.VOIX_MODELE; // aucune voix demandée : on a le droit de se replier sur une voix déjà installée

  const fichiersPresents = () => fs.existsSync(cfg.piper) && fs.existsSync(cfg.fichierModele) && fs.existsSync(cfg.fichierModele + '.json');

  function synthetiser(texte, wav) {
    return new Promise((resolve, reject) => {
      const args = ['--model', cfg.fichierModele, '--output_file', wav, '--sentence_silence', '0.35'];
      if (cfg.locuteur != null) args.push('--speaker', String(cfg.locuteur));
      if (cfg.bruit != null) args.push('--noise_scale', String(cfg.bruit));
      if (cfg.bruitW != null) args.push('--noise_w', String(cfg.bruitW));
      if (cfg.vitesseVoix !== 1) args.push('--length_scale', String(cfg.vitesseVoix));
      const p = spawn(cfg.piper, args, { cwd: path.dirname(cfg.piper), stdio: ['pipe', 'ignore', 'pipe'] });
      let erreurs = '';
      p.stderr.on('data', (d) => { erreurs = (erreurs + d).slice(-2000); });
      const minuteur = setTimeout(() => p.kill('SIGKILL'), 15 * 60e3);
      p.on('error', (err) => { clearTimeout(minuteur); reject(new Error(`Piper ne démarre pas : ${err.message}`)); });
      p.on('close', (code) => {
        clearTimeout(minuteur);
        if (code === 0 && fs.existsSync(wav)) resolve();
        else reject(new Error(`Piper a échoué (code ${code}) : ${erreurs.trim().split('\n').slice(-2).join(' | ')}`));
      });
      p.stdin.on('error', () => {}); // Piper s'est arrêté avant la fin de l'entrée : l'erreur vient du « close »
      p.stdin.end(texte);
    });
  }

  async function telechargerVoix() {
    for (const ext of ['.onnx.json', '.onnx']) {
      await telecharger(urlVoix(cfg.modele, cfg.revision) + ext, cfg.fichierModele.replace(/\.onnx$/, ext), journal);
    }
  }

  // La voix par défaut change entre deux versions de Brief : si elle ne peut pas être téléchargée (NAS sans accès à Internet un jour),
  // on garde la voix Piper déjà installée plutôt que de rester sans voix.
  function voixDejaInstallee() {
    const dossierVoix = path.dirname(cfg.fichierModele);
    let noms = [];
    try { noms = fs.readdirSync(dossierVoix).filter((f) => f.endsWith('.onnx') && fs.existsSync(path.join(dossierVoix, f + '.json'))); } catch { return null; }
    return noms.map((f) => f.replace(/\.onnx$/, '')).filter((m) => m !== cfg.modele && modeleCompatible(path.join(dossierVoix, m + '.onnx.json')))
      .sort((a, b) => (b === 'fr_FR-siwis-medium') - (a === 'fr_FR-siwis-medium') || a.localeCompare(b))[0] || null;
  }

  async function installer() {
    etat.installation = true;
    try {
      const archi = ARCHIVES[process.arch];
      if (!fs.existsSync(cfg.piper)) {
        if (!archi) throw new Error(`Processeur non géré par Piper : ${process.arch}`);
        const tgz = path.join(cfg.dossierPiper, 'piper.tar.gz');
        await telecharger(`https://github.com/rhasspy/piper/releases/download/${VERSION_PIPER}/piper_linux_${archi}.tar.gz`, tgz, journal);
        await lancer('tar', ['xzf', tgz, '-C', cfg.dossierPiper]);
        fs.rmSync(tgz, { force: true });
      }
      // Une voix déjà là mais réentraînée pour un autre moteur (téléchargée avant l'épinglage) est refaite à la bonne révision.
      if (fs.existsSync(cfg.fichierModele + '.json') && !modeleCompatible(cfg.fichierModele + '.json')) {
        journal(`La voix ${cfg.modele} n'est pas lisible par ce moteur : elle est retéléchargée (révision ${cfg.revision}).`);
        fs.rmSync(cfg.fichierModele, { force: true });
        fs.rmSync(cfg.fichierModele + '.json', { force: true });
      }
      if (!fs.existsSync(cfg.fichierModele) || !fs.existsSync(cfg.fichierModele + '.json')) await telechargerVoix();
      await verifier();
      etat.erreur = null;
      journal(`Voix prête : ${libelle}`);
    } catch (err) {
      etat.prete = false;
      etat.erreur = err.message;
      journal(`Voix indisponible (${libelle}) : ${err.message}`);
      const autre = voixParDefaut ? voixDejaInstallee() : null;
      if (autre) {
        const avant = libelle;
        Object.assign(cfg, { modele: autre, fichierModele: path.join(path.dirname(cfg.fichierModele), `${autre}.onnx`), locuteur: env.VOIX_LOCUTEUR ? Number(env.VOIX_LOCUTEUR) : null });
        libelle = nomVoix();
        try {
          await verifier();
          etat.erreur = null;
          journal(`${avant} est indisponible : on garde la voix déjà installée, ${libelle}.`);
        } catch (err2) {
          etat.prete = false;
          etat.erreur = err2.message;
          journal(`Voix indisponible (${libelle}) : ${err2.message}`);
        }
      }
    } finally {
      etat.installation = false;
    }
  }

  // Phrase d'essai : prouve que le moteur et la voix tournent sur ce processeur, et mesure le temps.
  async function verifier() {
    const essai = fs.mkdtempSync(path.join(require('os').tmpdir(), 'brief-essai-'));
    try {
      const t0 = Date.now();
      await synthetiser('Bonjour, ceci est un essai de la voix.', path.join(essai, 'essai.wav'));
      etat.essaiMs = Date.now() - t0;
      etat.prete = true;
    } finally {
      fs.rmSync(essai, { recursive: true, force: true });
    }
  }

  return { id: 'piper', get libelle() { return libelle; }, etat, config: cfg, phonetique: true, installee: fichiersPresents, installer, verifier, synthetiser };
}

module.exports = { creer, urlVoix, modeleCompatible, VOIX_DEFAUT, REVISION_VOIX };
