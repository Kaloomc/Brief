// La voix : un ou plusieurs moteurs interchangeables (dossier moteurs/), puis ffmpeg pour assembler.
//
//   VOIX_MOTEUR=piper            (par défaut) voix locale légère
//   VOIX_MOTEUR=kokoro           voix locale plus naturelle, plus lourde
//   VOIX_MOTEUR=azure            voix en ligne (clé d'API, voir moteurs/azure.js)
//   VOIX_MOTEUR=azure,piper      liste : si le premier échoue, on refait TOUT le brief avec le suivant (jamais deux voix dans un brief)
//
//   fabriquer({...})  → un seul MP3 (silence court entre les chapitres) + le manifest des chapitres
const fs = require('fs');
const path = require('path');
const { lancer } = require('./moteurs/commun');
const { preparer } = require('./prononciation');
const piper = require('./moteurs/piper');
const kokoro = require('./moteurs/kokoro');
const azure = require('./moteurs/azure');

const SILENCE_ENTRE_CHAPITRES = 0.9; // secondes
const DEBIT_MP3 = '64k'; // mono, débit constant : la lecture et les sauts restent précis dans Safari
const MOTEURS = { piper, kokoro, azure };

function configuration(env = process.env) {
  const demandes = (env.VOIX_MOTEUR || 'piper').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const chaine = [...new Set(demandes.filter((id) => MOTEURS[id]))];
  return {
    ffmpeg: env.FFMPEG || 'ffmpeg', ffprobe: env.FFPROBE || 'ffprobe',
    chaine: chaine.length ? chaine : ['piper'], inconnus: demandes.filter((id) => !MOTEURS[id]),
    auto: env.VOIX_AUTO_INSTALL !== '0',
  };
}

function creerVoix(dossierDonnees, { env = process.env, journal = console.log, fetchImpl } = {}) {
  const cfg = configuration(env);
  for (const id of cfg.inconnus) journal(`VOIX_MOTEUR : « ${id} » n'existe pas (piper, kokoro ou azure), ignoré.`);
  const moteurs = cfg.chaine.map((id) => MOTEURS[id].creer({ dossierDonnees, env, journal, ...(id === 'azure' && fetchImpl ? { fetchImpl } : {}) }));
  const etat = { prete: false, installation: false, erreur: null, moteur: moteurs[0].libelle, essaiMs: null, moteurs: [] };

  // Résumé pour l'écran Réglages : prête dès qu'un moteur de la liste est prêt.
  function synchroniser() {
    const pret = moteurs.find((m) => m.etat.prete);
    Object.assign(etat, {
      prete: !!pret, installation: moteurs.some((m) => m.etat.installation),
      erreur: pret ? null : moteurs.map((m) => m.etat.erreur).find(Boolean) ?? null,
      moteur: (pret || moteurs[0]).libelle, essaiMs: (pret || moteurs[0]).etat.essaiMs,
      moteurs: moteurs.map((m) => ({ id: m.id, libelle: m.libelle, prete: m.etat.prete, erreur: m.etat.erreur, enLigne: !!m.enLigne })),
    });
  }
  synchroniser();

  // Télécharge et vérifie chaque moteur de la liste (une phrase d'essai).
  async function installer() {
    etat.installation = true;
    try {
      for (const m of moteurs) {
        const suivi = setInterval(synchroniser, 1000);
        try { await m.installer(); } finally { clearInterval(suivi); }
        synchroniser();
      }
    } finally {
      synchroniser();
    }
  }
  const installee = () => moteurs.some((m) => m.installee());

  const dureeDe = async (fichier) => Number(await lancer(cfg.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier]));
  const prononciationsPerso = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dossierDonnees, 'prononciations.json'), 'utf8'));
    } catch {
      return {};
    }
  };

  // Synthèse d'un texte avec le moteur de la liste le plus prioritaire ; `synthetiser` ne sert que pour un essai isolé.
  const synthetiser = (texte, wav) => moteurs[0].synthetiser(preparer(texte, prononciationsPerso(), { dictionnaire: moteurs[0].phonetique }), wav);

  // Fabrique tout le brief avec UN moteur : un WAV par chapitre, puis le MP3 et le manifest.
  async function fabriquerAvec(synth, libelle, { date, chapitres, dossierAudio, meta, progression }) {
    fs.mkdirSync(dossierAudio, { recursive: true });
    const travail = fs.mkdtempSync(path.join(dossierAudio, `.${date}-`));
    try {
      const wavs = [];
      for (const [i, c] of chapitres.entries()) {
        progression(i, chapitres.length);
        const wav = path.join(travail, `chapitre-${i + 1}.wav`);
        await synth(c.voix, wav);
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
        voix: libelle, fabrique: new Date().toISOString(),
      };
      // Le manifest arrive en dernier : sans lui, l'audio n'est pas « prêt ».
      fs.renameSync(mp3, path.join(dossierAudio, `${date}.mp3`));
      fs.writeFileSync(path.join(dossierAudio, `${date}.json.tmp`), JSON.stringify(manifest, null, 1));
      fs.renameSync(path.join(dossierAudio, `${date}.json.tmp`), path.join(dossierAudio, `${date}.json`));
      return manifest;
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  }

  // chapitres : [{ titre, voix: 'texte nettoyé' }]. `moteur` : synthetiser(texte, wav), remplaçable (tests).
  async function fabriquer({ date, chapitres, dossierAudio, meta = {}, moteur, progression = () => {} }) {
    const dossier = { date, chapitres, dossierAudio, meta, progression };
    if (moteur) return fabriquerAvec(moteur, 'voix de test', dossier);
    let derniere;
    for (const m of moteurs) {
      try {
        // Chaque moteur reçoit le texte préparé pour lui (le dictionnaire de prononciation ne sert qu'aux moteurs qui en ont besoin).
        const manifest = await fabriquerAvec((t, w) => m.synthetiser(preparer(t, prononciationsPerso(), { dictionnaire: m.phonetique }), w), m.libelle, dossier);
        if (derniere) journal(`${date} : fabriqué avec ${m.libelle} (le moteur précédent a échoué).`);
        return manifest;
      } catch (err) {
        derniere = err;
        journal(`${date} : ${m.libelle} a échoué : ${err.message}`);
      }
    }
    throw derniere;
  }

  return { etat, installer, synthetiser, fabriquer, installee, moteurs, config: cfg };
}

module.exports = { creerVoix, configuration, SILENCE_ENTRE_CHAPITRES };
