// Azure AI Speech (voix neuronales Microsoft) : EN LIGNE, optionnel, jamais activé sans que tu l'aies demandé.
// Il faut VOIX_MOTEUR=azure (ou « azure,piper » : Piper prend le relais si Azure échoue), AZURE_SPEECH_KEY et AZURE_SPEECH_REGION.
//
// CE QUI EST ENVOYÉ À MICROSOFT : le texte parlé des chapitres (donc le chapitre « Ta journée », qui résume tes mails, tes tâches
// et tes repas). La clé reste dans les variables d'environnement du conteneur : jamais dans le dépôt, jamais écrite dans les journaux.
// Les voix françaises multilingues (fr-FR-VivienneMultilingualNeural, fr-FR-RemyMultilingualNeural) ou fr-FR-DeniseNeural gèrent
// seules les liaisons, les nombres, les sigles et les mots anglais : on ne leur envoie donc pas le dictionnaire de prononciation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lancer, attendre } = require('./commun');

const MAX_CARACTERES = 3500; // par requête (un chapitre de 5 minutes en fait environ 1 500)

const echapperXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Texte (une phrase par ligne) → SSML. Une courte pause entre les phrases, comme les autres moteurs.
function construireSsml(texte, voix, vitesse = 1) {
  const lignes = String(texte).split('\n').map((l) => l.trim()).filter(Boolean);
  const pourcent = Math.round((vitesse - 1) * 100);
  const corps = lignes.map((l) => echapperXml(l)).join('<break time="300ms"/>');
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="fr-FR"><voice name="${echapperXml(voix)}"><prosody rate="${pourcent >= 0 ? '+' : ''}${pourcent}%">${corps}</prosody></voice></speak>`;
}

// Découpe aux limites de lignes pour ne jamais dépasser MAX_CARACTERES par requête.
function decouper(texte) {
  const morceaux = [];
  let cour = '';
  for (const l of String(texte).split('\n')) {
    if (cour && cour.length + l.length + 1 > MAX_CARACTERES) { morceaux.push(cour); cour = ''; }
    cour += (cour ? '\n' : '') + l;
  }
  if (cour.trim()) morceaux.push(cour);
  return morceaux;
}

function creer({ dossierDonnees, env = process.env, journal = console.log, fetchImpl = (...a) => fetch(...a), ffmpeg = env.FFMPEG || 'ffmpeg' }) {
  const cfg = {
    cle: env.AZURE_SPEECH_KEY || '', region: (env.AZURE_SPEECH_REGION || '').trim(),
    voix: env.AZURE_VOIX || 'fr-FR-VivienneMultilingualNeural', vitesse: Number(env.AZURE_VITESSE) || 1,
  };
  const etat = { prete: false, installation: false, erreur: null, essaiMs: null };
  const libelle = `Azure ${cfg.voix}`;
  const adresse = () => `https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const configuree = () => !!cfg.cle && /^[a-z0-9]+$/i.test(cfg.region);

  // Une requête : renvoie les octets du WAV (PCM 24 kHz mono). Nouvelles tentatives sur 429 et 5xx.
  async function requete(texte) {
    let derniere;
    for (let essai = 0; essai < 3; essai++) {
      if (essai) await attendre(1500 * essai);
      const res = await fetchImpl(adresse(), {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': cfg.cle, 'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm', 'User-Agent': 'Brief',
        },
        body: construireSsml(texte, cfg.voix, cfg.vitesse),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const detail = (await res.text().catch(() => '')).slice(0, 200).replace(cfg.cle, '***');
      derniere = new Error(`Azure a répondu ${res.status}${res.status === 401 || res.status === 403 ? ' (clé ou région refusée)' : res.status === 429 ? ' (quota ou débit dépassé)' : ''} ${detail}`.trim());
      if (res.status !== 429 && res.status < 500) break; // inutile de réessayer une clé refusée
    }
    throw derniere;
  }

  async function synthetiser(texte, wav) {
    if (!configuree()) throw new Error('Azure : AZURE_SPEECH_KEY ou AZURE_SPEECH_REGION manquant.');
    const morceaux = decouper(texte);
    if (!morceaux.length) throw new Error('Aucun texte à lire');
    if (morceaux.length === 1) return fs.writeFileSync(wav, await requete(morceaux[0]));
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-azure-'));
    try {
      const fichiers = [];
      for (const [i, m] of morceaux.entries()) {
        const f = path.join(travail, `${i}.wav`);
        fs.writeFileSync(f, await requete(m));
        fichiers.push(f);
      }
      fs.writeFileSync(path.join(travail, 'liste.txt'), fichiers.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      await lancer(ffmpeg, ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(travail, 'liste.txt'), '-c:a', 'pcm_s16le', wav]);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  }

  async function verifier() {
    if (!configuree()) throw new Error('Azure : AZURE_SPEECH_KEY et AZURE_SPEECH_REGION (par exemple francecentral) sont à renseigner.');
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
      await verifier(); // une seule phrase d'essai (« Bonjour, ceci est un essai de la voix. ») part chez Microsoft
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

  return { id: 'azure', libelle, etat, config: cfg, phonetique: false, enLigne: true, installee: configuree, installer, verifier, synthetiser };
}

module.exports = { creer, construireSsml, decouper, echapperXml };
