# La voix de Brief : ce qui a été mesuré, ce qui ne l'a pas été

Demande de départ : « la voix est robotique, elle ne fait pas les liaisons ». Ce document dit **ce qui a été mesuré** (et comment), **ce qui n'a pas pu l'être**, et ce qui en découle.

> **Limite principale, à lire d'abord.** Je ne peux pas *écouter* : aucune des mesures ci-dessous ne dit si une voix « sonne naturelle ». Elles disent si les mots sont reconnaissables, si les liaisons sont produites, si la voix est monotone, et combien elle coûte en calcul. Le jugement final, c'est **toi** qui le portes, avec les échantillons du dossier `echantillons/` (voir son `00-LISEZ-MOI.txt`).

## 1. Ce qu'on a découvert avant même de comparer

1. **Un bug d'installation, corrigé.** Le 9 novembre 2026, le dépôt des voix Piper (`rhasspy/piper-voices`, branche `main`) a été mis à jour (« Retrain voices from the rdh and hifi_tts_92 bases ») : la voix `fr_FR-siwis-medium` y est désormais au format « Piper 1.5 », que le moteur utilisé par Brief (Piper 2023.11.14-2) **refuse** (`Phonemes must be one codepoint`, plantage immédiat). Un NAS qui installait la voix après cette date n'aurait eu **aucune voix**. Brief télécharge maintenant la révision épinglée `v1.0.0` et refait tout seul une voix incompatible déjà présente (test automatique).
   Les réglages par défaut d'origine de `siwis` (révision `v1.0.0`) sont ceux de Piper : `noise_scale 0,667`, `noise_w 0,8`.
2. **Les liaisons courantes sont déjà phonétisées.** Le moteur de phonétisation (espeak-ng, commun à Piper et à Kokoro) produit : les‿amis `le-z amˈi`, des‿enfants, trois‿heures `tʁwˈaz ˈœʁ`, six‿ans, neuf‿ans (`nˈœv`), nos‿amis, les États‿Unis, ils‿ont ; et il n'en met pas là où il n'en faut pas (les héros, un hôtel). Ce qui était **mal lu** (phonèmes relevés) : `l'IA` → « lia », `NAS` → « na », `iPhone` → « i fonne », `21 h` → « vingt-et-un ache », `2e` → « deux eu », `XXe siècle`, les mots anglais (`Ocarina of Time` en phonèmes anglais). Le module `prononciation.js` corrige ces cas. Un faux positif reste possible : « depuis Angoulême » reçoit un « z » de liaison (la voix dit « depuis‿z‿Angoulême »).
   Conséquence : si la voix paraît « sans liaisons » à l'oreille, c'est plus probablement **la voix elle-même** (rythme, intonation plate) que le texte.

## 2. Méthode (reproductible : `outils/` n'est pas nécessaire, tout est dans le texte ci-dessous)

- Machine : Intel Core i5-10210U (4 cœurs, 8 threads), 7,8 Go de RAM dont 2,3 Go libres, **pas de GPU**. Ce n'est pas le NAS.
- Texte A (« court », 150 mots, 40 s) : phrases pièges (liaisons, nombres, sigles, anglicismes). Texte B (« long », 449 mots, 2 min 45) : trois chapitres d'un vrai brief du 4 novembre.
- Chaque texte est lu **tel quel** (« brut ») et **avec le prétraitement** (« prép. »).
- **Lisibilité** : transcription par Whisper `small` (faster-whisper, français), chiffres ramenés en lettres des deux côtés, **WER** (taux d'erreur de mots) contre le texte voulu. Plus bas = mieux. Une erreur = 0,7 point sur le texte A : les écarts de moins de 0,03 sont du bruit.
- **Prosodie** : hauteur de la voix (F0, Praat) : écart-type en demi-tons. Une lecture naturelle en français varie autour de 3 à 4 ; une voix « monotone » est plus basse. Indicateur grossier, pas un score de naturel.
- **Vitesse** : « × » = secondes d'audio par seconde de calcul (10 × : 5 minutes d'audio en 30 s).
- **Liaisons** : 24 phrases courtes (les amis, un grand homme, des enfants, trois heures, les héros…), transcrites par Whisper ; la liaison est « réussie » si le groupe attendu est reconnu. Whisper corrige un peu les erreurs : un échec est significatif, une réussite l'est moins.
- **Non fait** : note de naturel automatique (UTMOS) : elle demande d'exécuter du code téléchargé d'un dépôt tiers, que je n'ai pas lancé. Écoute humaine : impossible pour moi.

## 3. Résultats mesurés

### Texte A (court, prétraité)

| Voix | WER | F0 (demi-tons) | Vitesse | Liaisons (sur 24) |
|---|---|---|---|---|
| Piper siwis (v1.0.0) — **la voix d'avant** | 0,13 | 2,8 | 9,4 × | 22 |
| Piper siwis, `noise` 0,5 / 0,33 (plus calme) | 0,12 | 2,7 | 7,8 × | |
| Piper siwis, `noise` 0,85 / 1,0 (plus vivant) | 0,12 | 2,7 | 8,2 × | |
| Piper siwis réentraînée (nouveau moteur Piper 1.8) | 0,12 | 2,9 | 7,7 × | |
| Piper upmc, voix 0 (femme) | 0,15 | 2,4 | 11,0 × | 21 |
| **Piper upmc, voix 1 (homme)** | **0,08** | **3,2** | 11,7 × | 20 |
| Piper tom (44 kHz) | 0,09 | 2,5 | 4,9 × | 19 |
| Piper gilles (basse qualité) | 0,16 | 2,6 | 13,9 × | |
| Piper mls (voix 0) | 0,23 | **1,6 (monotone)** | 8,7 × | |
| **Kokoro ff_siwis** (float 32) | **0,08** | 2,7 | **1,3 ×** | **23** |
| Kokoro (int8, plus petit) | 0,09 | 2,6 | 1,1 × | |

### Texte B (long, 449 mots)

| Voix | WER brut | WER prép. | F0 | Vitesse |
|---|---|---|---|---|
| Piper siwis | 0,11 | 0,11 | 2,7 | 10 × |
| Piper upmc voix 1 | 0,13 | 0,12 | 3,1 | 10 × |
| Piper tom | 0,11 | 0,12 | 2,3 | 4–5 × |
| Kokoro | 0,15 | **0,11** | 2,3 | 0,8–1,2 × |

### Coût de calcul (un seul cœur, 1 phrase de 40 s)

| | Vitesse | Mémoire (pic) |
|---|---|---|
| Piper | **10,5 ×** | 220 Mo |
| Kokoro float 32 | **1,4 ×** | 650 Mo |
| Kokoro int8 | 1,1 × | 400 Mo |

Piper et Kokoro n'utilisent pratiquement qu'un cœur : passer de 2 à 8 threads ne change rien. **Pour un NAS** (processeur inconnu, supposé 2 à 3 fois plus lent par cœur que ce portable) : Piper fait un brief de 5 minutes en **1 à 1,5 minute** ; Kokoro en **7 à 10 minutes** et 650 Mo de RAM. Les deux tiennent entre 6 h 30 et 7 h, mais Kokoro n'a plus de marge si le NAS est plus lent que prévu. **Rien de cela n'est mesuré sur le NAS.**

### Ce que les chiffres disent, honnêtement

- **Aucune voix locale ne se détache** sur la lisibilité : sur le long texte, tout est entre 0,11 et 0,13 (bruit compris). Le meilleur résultat du texte A (upmc voix 1, Kokoro) ne se confirme pas sur le texte B pour upmc.
- **Le prétraitement aide surtout Kokoro** (0,149 → 0,114 sur le long texte : sigles, noms propres, chiffres) ; il ne change rien d'audible pour Piper siwis sur ce texte (qui ne contient presque pas de chiffres, Claude les écrit en lettres), mais il évite les vraies erreurs (« 21 h », « 2e », « l'IA », « iPhone »).
- **Les liaisons sont globalement bien faites par tous** (19 à 23 sur 24). Les échecs sont presque tous des pluriels ou des chiffres que Whisper entend mal (« d'autres » → « d'autre »), pas des liaisons absentes.
- **Variation de hauteur** : upmc voix 1 est la plus vivante des voix Piper (3,1–3,2), mls la plus monotone (1,6) ; tom et Kokoro sont plus plates (2,3–2,5) malgré leur réputation. D'où le choix d'**upmc voix 1** comme voix locale par défaut, faute de mieux. C'est un choix par défaut, pas une démonstration : une voix d'homme, alors que tu avais entendu une voix de femme (`VOIX_LOCUTEUR=0` pour la voix de femme d'upmc ; `VOIX_MODELE=fr_FR-siwis-medium` pour revenir à l'ancienne).

## 4. Moteurs locaux non essayés (pourquoi)

Les informations ci-dessous viennent de recherches web (sources variables : pas des mesures de ma part).

| Moteur | Pourquoi pas testé | Ce qu'on en sait |
|---|---|---|
| XTTS-v2 (Coqui) | modèle de 2 milliards de paramètres, 2 Go de poids, RAM disponible ici : 2,3 Go ; licence **CPML : usage non commercial seulement** (convient à un usage perso) | bon français ; sur processeur, les rapports vont de « irréalisable » à « environ 0,4 × » : hors de portée d'un NAS |
| F5-TTS | poids sous licence **CC-BY-NC** ; conçu pour GPU | modèles français communautaires ; lent sur processeur |
| Chatterbox multilingue | pas de preuve trouvée sur la qualité du français ni sur la vitesse processeur | clonage de voix ; modèle 0,5 milliard de paramètres |
| MeloTTS (MIT) | pas de preuve de qualité en français ; une seule voix | tourne en temps réel sur processeur |
| Orpheus | modèle de langage de 3 milliards de paramètres | GPU nécessaire |

## 5. Voix en ligne (non essayées : aucune clé, **rien n'a été envoyé à un service externe**)

Brief fabrique environ **4 300 caractères par jour, soit 130 000 par mois**.

| Service | Voix françaises | Tarif cité (sources tierces, à confirmer sur les pages officielles) | Coût mensuel pour 130 000 caractères |
|---|---|---|---|
| **Azure AI Speech** | `fr-FR-VivienneMultilingualNeural`, `RemyMultilingualNeural`, `DeniseNeural` | 0,5 million de caractères gratuits par mois (page Azure) ; ensuite environ 15 à 16 dollars le million (voix HD environ 22) | **0 €** (sous la limite gratuite) |
| Google Cloud TTS | Neural2, Chirp 3 HD | Neural2 16 dollars le million, Chirp 3 HD 30 dollars ; **1 million gratuit par mois** pour chacun (page Google) | **0 €** |
| OpenAI | `tts-1` (15 dollars le million), `gpt-4o-mini-tts` (environ 0,015 dollar la minute) | une source annonce l'arrêt de ces modèles le 6 janvier 2027 : à vérifier | environ 2 dollars |
| ElevenLabs | multilingues | environ 0,05 à 0,10 dollar les 1 000 caractères (sources en désaccord) ; offre gratuite de 10 000 crédits | environ 7 à 13 dollars, plan payant nécessaire |

Ce qu'il faut côté clé : un compte (Azure ou Google), une ressource « Speech » / une clé d'API, copiée **dans le YAML du NAS seulement** (`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`). Le texte des chapitres, **y compris « Ta journée » (résumé de tes mails, tâches, repas)**, serait envoyé au service. C'est la vraie contrepartie : à toi de décider.

## 6. Recommandation

**Un choix : Azure `fr-FR-VivienneMultilingualNeural`, avec Piper en secours automatique** (`VOIX_MOTEUR=azure,piper`).

- C'est la seule option de cette liste dont la réputation justifie de s'attendre à une voix réellement naturelle (liaisons, rythme, nombres, mots anglais gérés par le service), alors que les mesures ci-dessus ne montrent **aucun gain décisif entre les voix locales**.
- Coût : 0 € dans ton volume (limite gratuite d'Azure), et Piper reprend la main si le quota, le réseau ou la clé lâchent : le brief du matin est fabriqué dans tous les cas.
- Contrepartie : le texte part chez Microsoft. Si ce n'est pas acceptable : reste en local (`VOIX_MOTEUR=piper`, défaut), choisis ta voix avec les échantillons, et n'essaie `kokoro` que si ton NAS le permet (7 fois plus lent).
- **Je n'ai pas pu essayer Azure** (pas de clé, pas d'envoi sans ton accord) : le code est testé avec un faux serveur (requête SSML, clé jamais dans les erreurs, aucune requête sans clé, repli sur Piper), pas contre le vrai service. Si la première matinée sonne mal, c'est la première chose à regarder dans le Journal.

## 7. Régler à la main

- `data/prononciations.json` : `{ "Angoulême": "Ongoulême" }` — un mot mal lu, tu écris comme ça se prononce.
- Piper : `PIPER_NOISE_SCALE` / `PIPER_NOISE_W` (plus haut = plus de variation, plus d'artefacts), `PIPER_LENGTH_SCALE` (0,9 = 10 % plus rapide).
