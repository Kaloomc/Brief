# Lit du texte (une phrase par ligne) sur l'entrée standard et écrit un WAV avec Kokoro (ONNX).
# Appelé par moteurs/kokoro.js : python kokoro_synth.py MODELE.onnx VOIX.bin VOIX_NOM VITESSE SORTIE.wav
import sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

modele, voix_bin, voix, vitesse, sortie = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5]
kokoro = Kokoro(modele, voix_bin)
morceaux, freq = [], 24000
for ligne in sys.stdin.read().splitlines():
    if not ligne.strip():
        continue
    audio, freq = kokoro.create(ligne, voice=voix, speed=vitesse, lang="fr-fr")
    morceaux += [audio, np.zeros(int(freq * 0.3), dtype=np.float32)]  # 0,3 s de silence entre les phrases
if not morceaux:
    sys.exit("Aucun texte à lire")
sf.write(sortie, np.concatenate(morceaux), freq)
