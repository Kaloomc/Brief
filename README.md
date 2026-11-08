# Brief

Le **podcast du matin** de la suite d'applis perso (avec Repax, Agendix et Argenx). Chaque matin, un brief d'environ 5 minutes est prêt : tu appuies sur lecture (écran verrouillé compris), tu peux aussi faire défiler pour **lire le texte** et ouvrir les **sources** de chaque sujet.

Contenu choisi : ta journée (repas, courses urgentes, tâches Notion, mails à traiter en lecture seule), actualité France et monde, IA et tech, sport, jeux vidéo et culture.

## Qui fait quoi

| | |
|---|---|
| **Tâche planifiée Claude « Brief du matin »** (6 h 21, heure de Paris) | Écrit une page dans la base Notion **« Brief du matin »** (sous la page « Gestion »). **C'est elle qui rédige : Brief n'écrit rien et n'appelle aucun modèle.** |
| **Brief** (cette appli, sur le NAS) | Lit la base, fabrique l'audio avec une voix locale, sert l'audio et l'écran. |
| **Notion** | Garde pour toujours le texte et les sources. Brief n'y écrit que `Audio (URL)` et `Statut` (→ « Audio prêt »). |

## Lancer en local

Il faut Node.js 20 ou plus récent, et `ffmpeg` pour l'audio.

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3014. Sans `NOTION_TOKEN`, c'est le **mode démo** : trois briefs fictifs (le texte est inventé) et un vieux brief dont l'audio a « expiré ». La voix est téléchargée toute seule au premier lancement (Piper et la voix française, environ 115 Mo, dans `data/`) puis fabrique l'audio des briefs de démo. Sans `APP_PASSWORD`, le serveur n'écoute que sur 127.0.0.1.

Tests : `npm test` (aucun réseau, ni Notion ni voix : un son de test remplace la voix, ffmpeg est utilisé pour de vrai).

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `APP_PASSWORD` | **Obligatoire en ligne.** Mot de passe demandé une fois par téléphone ; protège l'API **et les fichiers audio**. Vide : l'appli n'écoute que sur 127.0.0.1. |
| `NOTION_TOKEN`, `NOTION_PAGE_ID` | **Les mêmes que Repax, Agendix et Argenx** (la page « Gestion »). La base « Brief du matin » est retrouvée par son titre dans cette page. Vides : mode démo. |
| `URL_PUBLIQUE` | Adresse publique de l'appli, écrite dans `Audio (URL)` (`https://teranga-nas.synology.me:8447`). |
| `WIDGET_TOKEN` | Widget iPhone, 32 caractères au minimum ; vide = pas de widget. |
| `VOIX_MODELE` | Voix Piper (`fr_FR-siwis-medium` par défaut ; `fr_FR-upmc-medium`, `fr_FR-tom-medium`, `fr_FR-siwis-low`). |
| `NOTION_BASE_BRIEF` | Facultatif : identifiant de la **base** (pas la collection) si on ne veut pas la chercher par son titre. |
| `PORT` | 3014 par défaut. |
| `DOSSIER_DONNEES`, `PIPER_DIR`, `FFMPEG`, `FFPROBE`, `PIPER_LENGTH_SCALE`, `VOIX_AUTO_INSTALL=0` | Pour les cas particuliers (tests, voix déjà installée, voix plus rapide : `PIPER_LENGTH_SCALE=0.9`). |

## La base Notion « Brief du matin »

Propriétés lues : `Titre`, `Date`, `Statut` (`Script prêt`, `Audio prêt`, `Erreur`), `Durée estimée (min)`, `Sujets`, `Audio (URL)`, `Nombre de mots`.
**Brief n'écrit que `Audio (URL)` et `Statut`** (→ `Audio prêt`), jamais le contenu d'une page ni une autre base ; `Erreur` est réservé à la tâche Claude. Un test (`npm test`) vérifie cette règle sur les requêtes envoyées à Notion.

Contenu d'une page (écrit par la tâche Claude) : des chapitres sous la forme

```
## Titre du chapitre
Texte parlé (un ou plusieurs paragraphes).

Sources :
- [Titre de l'article (Nom du site)](https://...)
```

Le parseur ([parseur.js](parseur.js)) tolère : un chapitre en moins, un chapitre sans sources, une source sans lien (« - Notion »), des titres de chapitres différents, « Source » au singulier, des sources sur une seule ligne, du texte avant le premier titre. Seuls les liens `http` et `https` deviennent des liens.

## Fabrication de l'audio

1. **Quand** : toutes les 10 minutes de 6 h 30 à 10 h (heure de Paris), puis toutes les heures ([planificateur.js](planificateur.js)). Une vérification = **une** requête Notion (la liste, sans le corps des pages).
2. **Quoi** : chaque page dont `Statut` = `Script prêt` et qui n'a pas d'audio. Une page qui a déjà son audio n'est pas refaite, **sauf si `Nombre de mots` a changé** (le script a été réécrit). Les pages de plus de 30 jours sont ignorées.
3. **Nettoyage avant la voix** ([nettoyage.js](nettoyage.js)) : plus de Markdown, d'adresses, de sources, d'émojis ; `€` → « euros », `%` → « pour cent », `°C` → « degrés Celsius », `&` → « et », `n°` → « numéro »…
4. **Voix** : [Piper](https://github.com/rhasspy/piper), en local, voix française `fr_FR-siwis-medium`. Un fichier par chapitre, puis **un seul MP3** (mono, 64 kb/s à débit constant, 0,9 s de silence entre les chapitres) assemblé par ffmpeg. À côté : `data/audio/AAAA-MM-JJ.json`, le **manifest** (début et durée de chaque chapitre, durée totale).
5. **Servir** : `/audio/AAAA-MM-JJ.mp3`, type `audio/mpeg`, requêtes `Range` (206 / 416), protégé par le mot de passe.
6. **Notion** : juste avant d'écrire, la page est relue ; si le script a changé pendant la fabrication, rien n'est écrit (il sera refait). Puis `Audio (URL)` et `Statut` = `Audio prêt`.
7. **Si la voix échoue** : deux nouvelles tentatives, puis le texte reste lisible dans l'appli avec un message clair et un bouton « Réessayer l'audio ». `Statut` n'est **jamais** mis à `Erreur`. Si Notion est injoignable à l'écriture, l'audio reste lisible et Notion est mis à jour à la vérification suivante.
8. **Conservation** : 30 jours d'audio (MP3 + manifest), puis suppression. Le texte et les sources restent dans Notion (et en cache sur le NAS).

### Vitesse de la voix (mesurée)

Mesure faite sur un ordinateur portable (Intel Core i5-10210U, 4 cœurs / 8 threads), pas sur le NAS : un brief de **663 mots → 4 min 15 s d'audio** en **37 s** sur un seul cœur (soit 7 fois plus vite que l'écoute), 27 s avec la voix `siwis-low`. Un NAS d'entrée de gamme peut être 3 à 5 fois plus lent : il faut s'attendre à **2 à 3 minutes** pour un brief de 5 minutes, ce qui est largement dans le temps disponible. À l'installation, l'appli fait **une phrase d'essai** : l'écran Réglages indique si la voix tourne sur ce processeur et en combien de temps. Si ce n'est pas assez rapide : `VOIX_MODELE=fr_FR-siwis-low`, ou un service de voix en ligne (payant, clé d'API) en secours (non branché pour l'instant).

## Écrans

- **Aujourd'hui** : titre, date, durée ; gros bouton lecture/pause, ±15 secondes, barre de progression, vitesse (1×, 1,25×, 1,5×, 2×) ; liste des chapitres avec leur durée (un appui saute au début) ; en dessous le texte de chaque chapitre et ses sources (titre, site, un appui ouvre dans un nouvel onglet avec `rel="noopener noreferrer"`). Le chapitre en cours est mis en avant et suivi automatiquement (un geste de défilement suspend le suivi : bouton « Suivre la lecture »). Une mini-barre garde le lecteur sous la main quand on lit plus bas.
  États : « Le brief arrive » (avant 10 h, rien d'écrit), « Audio en préparation » (le texte est déjà lisible), « Brief indisponible » (rien à 10 h), « Audio indisponible » (la voix a échoué, avec « Réessayer »), statut « Erreur » signalé. Sans audio : « Lire avec la voix de l'iPhone » (en dernier recours, avec l'avertissement que ça s'arrête quand l'écran se verrouille).
- **Archives** : les briefs par date (titre, durée, sujets), pastille « écouté », recherche par mot du titre ou du texte ; un appui ouvre le brief dans le même lecteur. Audio supprimé (plus de 30 jours) : « texte seul ».
- **Réglages** : vitesse par défaut, heure du rappel, état de la voix. Pas de réglage de sujets : ils sont définis dans la tâche planifiée.

### Lecteur

Élément `<audio>` standard (pas la Web Audio API). **Media Session** : titre, artiste « Brief du matin », pochette, lecture/pause, ±15 s, précédent/suivant = chapitres, position (barre sur l'écran verrouillé). La lecture ne démarre que sur un appui. Reprise : la position est gardée sur le téléphone et sur le serveur (la plus récente gagne) ; « écouté » à partir de 90 %. Hors ligne : le dernier brief (texte, sources) s'ouvre depuis le cache, et l'audio déjà téléchargé (les 3 derniers) se lit depuis le cache du téléphone.

### Rappel du matin (Web Push)

Une notification « Ton brief est prêt », une fois par jour, à partir de l'heure choisie et dès que l'audio est prêt. Elle ne contient aucun texte du brief. Clés VAPID créées au premier lancement (`data/vapid.json`). Sur iPhone : iOS 16.4 ou plus, appli ajoutée à l'écran d'accueil.

## Quota Notion

La liste des briefs : **une requête** (sans le corps des pages), gardée 15 minutes. Le corps d'une page : lu à l'ouverture d'un brief (ou à la fabrication de l'audio), puis gardé par date dans `data/textes/` ; un brief passé n'est plus relu (sauf si son `Nombre de mots` change), celui du jour au plus une fois par heure. Le widget ne lit que le cache. La recherche par texte porte sur les textes déjà lus.

## Sécurité

- Mot de passe (cookie `brief`, HttpOnly, un an) pour l'API **et** les fichiers audio, comme les autres applis.
- Les textes des briefs viennent de pages web et de mails résumés : ils sont affichés avec `textContent`, jamais en HTML ; aucun contenu n'est exécuté (un test vérifie que `app.js` n'insère jamais de HTML). En-têtes `Content-Security-Policy` stricts (aucun script en ligne, rien d'extérieur), liens des sources en `noopener noreferrer`, adresses limitées à `http(s)`.
- Aucune action sur les mails depuis l'appli : elle ne peut que lire un résumé écrit par la tâche Claude.

## Widget iPhone (optionnel)

`GET /api/widget/brief` avec `Authorization: Bearer <WIDGET_TOKEN>` renvoie
`{ "date", "title", "durationMin", "ready", "chaptersCount" }`.
Mêmes règles que Repax : jeton d'au moins 32 caractères (sinon la route n'existe pas), comparé en temps constant, jamais de cookie ni d'appel à Notion (cache seulement), 60 requêtes par heure, 20 essais ratés par heure et par adresse.

## Fichiers

| Fichier | Rôle |
|---|---|
| `server.js` | Routes, mot de passe, audio avec `Range`, démarrage |
| `notion.js` | Accès Notion (lecture + les deux écritures autorisées) |
| `demo.js` | « Notion » fictif en mémoire (mode démo) |
| `parseur.js` | Texte de la page → chapitres, texte, sources |
| `nettoyage.js` | Texte → texte propre pour la voix |
| `voix.js` | Piper (installation, essai, synthèse) et assemblage ffmpeg + manifest |
| `audio.js` | Quelles pages traiter, tentatives, écriture Notion, conservation 30 jours |
| `planificateur.js` | Les heures de vérification |
| `donnees.js` | Cache de la liste (15 min), des textes, progression, réglages |
| `rappel.js`, `widget.js`, `temps.js` | Notification du matin, widget, dates de Paris |
| `public/` | L'appli (HTML, CSS, JS simples, service worker, icônes) |
| `outils/icones.py` | Fabrique les icônes (`python3 outils/icones.py`) |
| `docs/MISE-EN-LIGNE.md` | Mise en ligne pas à pas sur le NAS |

## Mise en ligne

Voir [`docs/MISE-EN-LIGNE.md`](docs/MISE-EN-LIGNE.md) : NAS Synology (Docker), proxy inversé HTTPS sur le port **8447**, Freebox, écran d'accueil.
