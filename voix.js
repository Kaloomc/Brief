// La voix, en local : Piper (https://github.com/rhasspy/piper) pour lire le texte, ffmpeg pour assembler.
// Rien ne sort du NAS. Piper et la voix française sont téléchargés une seule fois dans data/piper et data/voix.
//
//   synthetiser(texte, wav)   → un fichier WAV (un chapitre)
//   fabriquer({...})          → un seul MP3 (silence court entre les chapitres) + le manifest des chapitres
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const VERSION_PIPER = '2023.11.14-2';
const ARCHIVES = { x64: 'x86_64', arm64: 'aarch64', arm: 'armv7l' };
const VOIX_DEFAUT = 'fr_FR-siwis-medium'; // voix féminine, claire ; « fr_FR-upmc-medium » et « fr_FR-tom-medium » existent aussi
const SILENCE_ENTRE_CHAPITRES = 0.9; // secondes
const DEBIT_MP3 = '64k'; // mono, débit constant : la lecture et les sauts restent précis dans Safari

const lancer = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60e3, ...opts }, (err, stdout, stderr) => {
    if (err) reject(new Error(`${path.basename(cmd)} a échoué : ${(stderr || err.message).toString().trim().split('\n').slice(-3).join(' | ')}`));
    else resolve(stdout);
  });
});

function configuration(dossierDonnees, env = process.env) {
  const modele = env.VOIX_MODELE || VOIX_DEFAUT;
  const dossierPiper = env.PIPER_DIR || path.join(dossierDonnees, 'piper');
  return {
    ffmpeg: env.FFMPEG || 'ffmpeg',
    ffprobe: env.FFPROBE || 'ffprobe',
    dossierPiper,
    piper: path.join(dossierPiper, 'piper', 'piper'),
    modele,
    fichierModele: path.join(dossierDonnees, 'voix', `${modele}.onnx`),
    vitesseVoix: Number(env.PIPER_LENGTH_SCALE) || 1, // < 1 : plus rapide
    auto: env.VOIX_AUTO_INSTALL !== '0',
  };
}

// « fr_FR-siwis-medium » → https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx
function urlVoix(modele) {
  const [lang, nom, qualite] = modele.split('-');
  return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang.split('_')[0]}/${lang}/${nom}/${qualite}/${modele}`;
}

async function telecharger(url, destination, journal) {
  journal(`Téléchargement : ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destination + '.part'));
  fs.renameSync(destination + '.part', destination);
}

function creerVoix(dossierDonnees, { env = process.env, journal = console.log } = {}) {
  const cfg = configuration(dossierDonnees, env);
  const etat = { prete: false, installation: false, erreur: null, moteur: `Piper ${cfg.modele}` };

  const piperPresent = () => fs.existsSync(cfg.piper) && fs.existsSync(cfg.fichierModele) && fs.existsSync(cfg.fichierModele + '.json');

  // Télécharge Piper et la voix la première fois, puis vérifie que le moteur tourne vraiment (une phrase d'essai).
  async function installer() {
    etat.installation = true;
    try {
      if (!piperPresent()) {
        const archi = ARCHIVES[process.arch];
        if (!archi) throw new Error(`Processeur non géré par Piper : ${process.arch}`);
        const tgz = path.join(cfg.dossierPiper, 'piper.tar.gz');
        if (!fs.existsSync(cfg.piper)) {
          await telecharger(`https://github.com/rhasspy/piper/releases/download/${VERSION_PIPER}/piper_linux_${archi}.tar.gz`, tgz, journal);
          await lancer('tar', ['xzf', tgz, '-C', cfg.dossierPiper]);
          fs.rmSync(tgz, { force: true });
        }
        if (!fs.existsSync(cfg.fichierModele + '.json')) await telecharger(urlVoix(cfg.modele) + '.onnx.json', cfg.fichierModele + '.json', journal);
        if (!fs.existsSync(cfg.fichierModele)) await telecharger(urlVoix(cfg.modele) + '.onnx', cfg.fichierModele, journal);
      }
      await verifier();
      etat.erreur = null;
      journal(`Voix prête : ${etat.moteur}`);
    } catch (err) {
      etat.prete = false;
      etat.erreur = err.message;
      journal(`Voix indisponible : ${err.message}`);
    } finally {
      etat.installation = false;
    }
  }

  // Phrase d'essai : prouve que Piper, la voix et ffmpeg fonctionnent sur ce processeur, et mesure la vitesse.
  async function verifier() {
    const essai = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-essai-'));
    try {
      const t0 = Date.now();
      await synthetiser('Bonjour, ceci est un essai de la voix.', path.join(essai, 'essai.wav'));
      etat.essaiMs = Date.now() - t0;
      await lancer(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(essai, 'essai.wav')]);
      etat.prete = true;
    } finally {
      fs.rmSync(essai, { recursive: true, force: true });
    }
  }

  // Lit `texte` (une phrase par ligne) et écrit un WAV. Piper lit l'entrée standard.
  function synthetiser(texte, wav) {
    return new Promise((resolve, reject) => {
      const args = ['--model', cfg.fichierModele, '--output_file', wav, '--sentence_silence', '0.35'];
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

  const dureeDe = async (fichier) => Number(await lancer(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier]));

  // chapitres : [{ titre, voix: 'texte nettoyé' }]. `moteur` : synthetiser(texte, wav), remplaçable (tests).
  // Écrit dossierAudio/DATE.mp3 puis DATE.json (le manifest). Le manifest arrive en dernier : sans lui, l'audio n'est pas « prêt ».
  async function fabriquer({ date, chapitres, dossierAudio, meta = {}, moteur = synthetiser, progression = () => {} }) {
    fs.mkdirSync(dossierAudio, { recursive: true });
    const travail = fs.mkdtempSync(path.join(dossierAudio, `.${date}-`));
    try {
      const wavs = [];
      for (const [i, c] of chapitres.entries()) {
        progression(i, chapitres.length);
        const wav = path.join(travail, `chapitre-${i + 1}.wav`);
        await moteur(c.voix, wav);
        wavs.push({ wav, duree: await dureeDe(wav) });
      }
      progression(chapitres.length, chapitres.length);
      // Silence au même format que les chapitres : relevé sur le premier fichier.
      const format = (await lancer(cfg.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', wavs[0].wav])).trim().split(',');
      const [freq, canaux] = [format[0] || '22050', format[1] || '1'];
      const silence = path.join(travail, 'silence.wav');
      await lancer(cfg.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${freq}:cl=${canaux === '2' ? 'stereo' : 'mono'}`, '-t', String(SILENCE_ENTRE_CHAPITRES), '-c:a', 'pcm_s16le', silence]);

      const liste = [];
      const manifestChapitres = [];
      let debut = 0;
      wavs.forEach((w, i) => {
        if (i > 0) {
          liste.push(silence);
          debut += SILENCE_ENTRE_CHAPITRES;
        }
        liste.push(w.wav);
        manifestChapitres.push({ index: i, titre: chapitres[i].titre, debut: Math.round(debut * 100) / 100, duree: Math.round(w.duree * 100) / 100 });
        debut += w.duree;
      });
      const fichierListe = path.join(travail, 'liste.txt');
      fs.writeFileSync(fichierListe, liste.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      const mp3 = path.join(travail, 'brief.mp3');
      await lancer(cfg.ffmpeg, ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', fichierListe, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', DEBIT_MP3, '-f', 'mp3', mp3]);

      const duree = await dureeDe(mp3);
      const manifest = {
        date, ...meta, duree: Math.round(duree * 100) / 100, octets: fs.statSync(mp3).size, chapitres: manifestChapitres,
        voix: etat.moteur, fabrique: new Date().toISOString(),
      };
      fs.renameSync(mp3, path.join(dossierAudio, `${date}.mp3`));
      fs.writeFileSync(path.join(dossierAudio, `${date}.json.tmp`), JSON.stringify(manifest, null, 1));
      fs.renameSync(path.join(dossierAudio, `${date}.json.tmp`), path.join(dossierAudio, `${date}.json`));
      return manifest;
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  }

  return { etat, installer, verifier, synthetiser, fabriquer, config: cfg, piperPresent };
}

module.exports = { creerVoix, configuration, urlVoix, SILENCE_ENTRE_CHAPITRES };
