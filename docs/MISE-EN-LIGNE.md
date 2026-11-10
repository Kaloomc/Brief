# Mise en ligne pas à pas

But : Brief disponible sur **https://teranga-nas.synology.me:8447**, installé sur l'écran d'accueil du téléphone.
Même recette que Repax (3011 / 8444), Argenx (3012 / 8445) et Agendix (3013 / 8446), avec le port **3014** côté NAS et **8447** côté Internet.

---

## 1. Le code sur GitHub

Le conteneur récupère le code depuis https://github.com/Kaloomc/Brief à chaque démarrage. Le dépôt est **public** : il ne contient ni mot de passe, ni jeton, ni brief (le dossier `data/` est ignoré par Git).

1. Sur github.com, crée le dépôt **`Brief`** (public, sans README).
2. Dans le dossier du projet (`~/Projet/Brief`) :

```bash
git remote add origin git@github.com:Kaloomc/Brief.git
```

```bash
git push -u origin main
```

(L'adresse en `git@github.com:` utilise ta clé SSH ; en `https://`, GitHub demande des identifiants que cet ordinateur n'a pas.)

---

## 2. Notion : rien de nouveau à créer

Brief utilise **le même accès Notion que les autres applis** : reprends **`NOTION_TOKEN` et `NOTION_PAGE_ID`** de Repax (copiés depuis le YAML du projet `gestion-repas`).

La base **« Brief du matin »** est dans la page **« Gestion »**, comme « Présence », « Liste de courses »… Brief la retrouve par son titre dans la page indiquée par `NOTION_PAGE_ID`, exactement comme Repax retrouve ses bases. Il faut donc que `NOTION_PAGE_ID` soit **la page « Gestion »** (la même que pour Repax, Agendix et Argenx) et que l'intégration y ait accès (déjà fait pour les autres applis : page « Gestion » → **•••** → **Connexions**).

À savoir :
- L'identifiant donné dans le brief de départ (`collection://ea60193d-…`) est celui de la *collection*. L'API Notion utilisée par les applis (version 2022-06-28) attend celui de la *base* : Brief le trouve tout seul, tu n'as rien à copier.
- Brief **n'écrit que `Audio (URL)` et `Statut`** (→ « Audio prêt »). Pas besoin de droits supplémentaires : l'intégration des autres applis modifie déjà des pages.
- Sans `NOTION_TOKEN` : mode démo (brief fictif).

---

## 3. Créer le projet dans Container Manager

1. **File Station** → dossier `docker` → crée un dossier **`brief`**, puis **dedans** un dossier vide **`app`**.
   Il faut les **deux** : sans `/docker/brief/app`, le démarrage échoue avec `Bind mount failed: ... /app does not exist`.
2. **Container Manager** → **Projet** → **Créer** :
   - Nom du projet : `brief`
   - Chemin : `/docker/brief`
   - Source : **Créer un fichier docker-compose.yml**
3. Colle le contenu de [`docker-compose.yml`](../docker-compose.yml) et remplis :
   - `APP_PASSWORD=` un mot de passe à toi — **obligatoire** : sans lui, l'appli refuse d'écouter sur le réseau. Il protège aussi les fichiers audio, qui contiennent le résumé de tes mails et de ta journée.
   - `NOTION_TOKEN=` le même que Repax
   - `NOTION_PAGE_ID=` le même que Repax (la page « Gestion »)
   - `URL_PUBLIQUE=` déjà rempli (`https://teranga-nas.synology.me:8447`) : c'est l'adresse écrite dans `Audio (URL)`.
4. **Suivant** → (pas besoin de Web Station) → **Terminé**. Le projet démarre.
5. Vérifie : **Conteneur** → `brief` → **Journal**. Au **premier démarrage** (compte 3 à 5 minutes) tu verras :
   - l'installation de `git` et `ffmpeg` (l'image est Debian, pas Alpine : la voix Piper a besoin de glibc) ; `python3` seulement si tu choisis la voix Kokoro, et sans bloquer le démarrage s'il échoue ;
   - `Téléchargement : …piper_linux_x86_64.tar.gz` puis `…fr_FR-upmc-medium.onnx` (environ 150 Mo en tout, dans `/docker/brief/app/data`) ;
   - `Voix prête : Piper fr_FR-upmc-medium (voix 1)`, puis à la fin `Brief sur http://localhost:3014 (Notion activé)`.
   Si tu vois `APP_PASSWORD manquant`, le mot de passe n'est pas rempli. Si tu vois `Voix indisponible : …`, voir le dépannage.
   Aux démarrages suivants, ça prend quelques secondes.

Test sur le réseau de la maison : http://192.168.1.45:3014 (onglet **Réglages** → « Sur le serveur » : il doit indiquer *Voix prête* et le temps de la phrase d'essai).

**Vérifier que le NAS est assez rapide** : dans Notion, la tâche Claude écrit le brief à 6 h 21 ; à 6 h 30 Brief le voit et fabrique l'audio. Pour essayer tout de suite sur un brief qui n'a pas encore d'audio sur le NAS, remets son `Statut` à « Script prêt » dans Notion (et vide `Audio (URL)`) : à la prochaine vérification (toutes les 10 minutes le matin, toutes les heures ensuite, ou au redémarrage du projet) l'audio est refait, et le Journal indique `audio prêt (… s, 4 chapitres)`. Si la fabrication dépasse 10 minutes, passe à une voix plus légère : `- VOIX_MODELE=fr_FR-gilles-low` dans le YAML.

**Changer de voix** (voir le README, « La voix », et `docs/VOIX.md`) : dans le YAML, `VOIX_LOCUTEUR=0` (voix de femme, upmc), `VOIX_MODELE=fr_FR-siwis-medium` ou `fr_FR-tom-medium`, `VOIX_MOTEUR=kokoro` (plus naturelle selon les goûts, 7 fois plus lente), ou `VOIX_MOTEUR=azure,piper` avec `AZURE_SPEECH_KEY` et `AZURE_SPEECH_REGION` (voix en ligne, **le texte de tes briefs part chez Microsoft**, Piper en secours). Arrête, modifie, démarre. Les audios **déjà fabriqués** gardent l'ancienne voix : pour les refaire avec la nouvelle, ouvre **Réglages** → « Audios déjà fabriqués » → **Refaire avec la voix actuelle** (les 30 derniers jours, le plus récent d'abord, sans toucher à Notion ; l'ancien audio reste lisible si la nouvelle voix échoue). Remettre `Statut` à « Script prêt » dans Notion ne refait pas un audio qui existe déjà sur le NAS.

Les fichiers de Brief sont dans `/docker/brief/app/data` (audio des 30 derniers jours, textes en cache, progression d'écoute). Rien d'irremplaçable : le texte est dans Notion, et l'audio se refait. Tu peux quand même inclure `/docker/brief` dans Hyper Backup.

---

## 4. Proxy inversé HTTPS (port 8447)

**Panneau de configuration** → **Portail de connexion** → **Avancé** → **Proxy inversé** → **Créer** :

| | Source | Destination |
|---|---|---|
| Protocole | HTTPS | HTTP |
| Nom d'hôte | `teranga-nas.synology.me` | `localhost` |
| Port | `8447` | `3014` |

Nom de la règle : `brief`. Coche **Activer HSTS** si tu veux (comme pour les autres).

---

## 5. Certificat

**Panneau de configuration** → **Sécurité** → **Certificat** → **Paramètres** :
pour le service **`teranga-nas.synology.me:8447`** (la règle du proxy), choisis le certificat **teranga-nas.synology.me** → **OK**.

---

## 6. Ouvrir le port sur la Freebox

1. http://mafreebox.freebox.fr → **Paramètres de la Freebox** → **Mode avancé** → **Gestion des ports**.
2. **Ajouter une redirection** : IP de destination `192.168.1.45`, redirection active, IP source toutes, protocole **TCP**, port de début / fin **8447**, port de destination **8447**.
3. **Sauvegarder**.

Si le **pare-feu DSM** est activé (**Panneau de configuration** → **Sécurité** → **Pare-feu**), autorise aussi le port TCP **8447**.

Test depuis le téléphone **en 4G (Wi-Fi coupé)** : https://teranga-nas.synology.me:8447 → l'écran de connexion s'affiche.

---

## 7. Mettre l'appli sur l'écran d'accueil

### iPhone (avec Safari, obligatoirement)
1. Ouvre https://teranga-nas.synology.me:8447 dans **Safari** et connecte-toi.
2. Bouton **Partager** → **Sur l'écran d'accueil** → nom : `Brief` → **Ajouter**.
3. Ouvre **Brief depuis l'icône** (pas depuis Safari) : c'est là que l'écran verrouillé, le rappel et le mode hors ligne sont les plus fiables.

### Android (avec Chrome)
Menu **⋮** → **Installer l'application**.

### À vérifier une fois sur ton iPhone (je n'ai pas pu le tester)
- Appuie sur lecture, **verrouille l'écran** : le titre « Brief du matin », la pochette et les contrôles doivent apparaître et le son continuer. Sur l'écran verrouillé, iOS affiche **soit** les boutons précédent/suivant (= chapitres), **soit** les sauts de 15 secondes : si tu vois les chapitres, les sauts de 15 s restent sur l'écran de l'appli.
- Reprise après un appel : le son se met en pause pendant l'appel ; appuie sur lecture après (ou sur la pastille de l'écran verrouillé), la lecture repart au même endroit.
- Mode avion, puis ouverture de l'appli : le dernier brief (texte et sources) s'affiche ; l'audio se lit s'il a déjà été écouté ou ouvert sur ce téléphone.
- **Rappel du matin** (Réglages) : active-le, accepte les notifications. Si l'iPhone n'affiche rien au bout de la première matinée, c'est la partie la plus fragile : la lecture du brief n'en dépend pas.

---

## 8. Mettre à jour l'appli

1. Pousse les changements sur GitHub (`git push`).
2. **Container Manager** → **Projet** → `brief` → **Action** → **Redémarrer**.
Au redémarrage, le conteneur récupère la dernière version et lance les tests ; s'ils échouent, l'ancienne version est remise. Tes fichiers (`data/`) sont conservés, la voix n'est pas retéléchargée.

Pour changer le mot de passe ou un jeton : **Projet** → `brief` → **Arrêter** → **Modifier** le YAML → **Enregistrer** → **Démarrer**.

---

## 9. Widget iPhone (facultatif, à faire en dernier)

1. Invente un jeton long et aléatoire (32 caractères au minimum), mets-le dans `WIDGET_TOKEN=` (même méthode que Repax).
2. Le widget (Scriptable) appelle `GET https://teranga-nas.synology.me:8447/api/widget/brief` avec l'en-tête `Authorization: Bearer <jeton>` et reçoit :
   `{ "date": "2026-11-05", "title": "Brief du jeudi 5 novembre", "durationMin": 4.3, "ready": true, "chaptersCount": 4 }`.
3. Il ne lit que le cache de l'appli (jamais Notion) : 60 requêtes par heure au maximum.

---

## Dépannage

| Problème | Piste |
|---|---|
| `Bind mount failed` | Le dossier `/docker/brief/app` n'existe pas (étape 3.1) |
| Journal : `APP_PASSWORD manquant` | Remplis `APP_PASSWORD` dans le YAML |
| `Notion : la base « Brief du matin » n'est pas dans la page…` | `NOTION_PAGE_ID` n'est pas la page « Gestion », ou l'intégration n'y a pas accès (page « Gestion » → **•••** → **Connexions**) |
| `Notion : Could not find block` / `API token is invalid` | `NOTION_PAGE_ID` ou `NOTION_TOKEN` faux (comme pour Repax) |
| Réglages : `Voix indisponible : Téléchargement impossible` | Le NAS n'a pas pu télécharger Piper (GitHub) ou la voix (huggingface.co) : vérifie l'accès à Internet du conteneur, puis redémarre le projet |
| Réglages : `Voix indisponible : Piper a échoué (code 132 / 4)` ou `Illegal instruction` | Le processeur du NAS est trop ancien pour Piper : dis-le moi, on passera à un service de voix en ligne (payant, clé d'API) |
| `Voix indisponible : Processeur non géré` | Processeur ni x86_64 ni ARM 64 bits |
| « Audio indisponible » dans l'appli | La voix a échoué 3 fois : lis le message, corrige, puis **Réessayer l'audio** |
| « Audio en préparation » qui dure | Prochaine vérification dans 10 minutes au plus ; vérifie que `Statut` = « Script prêt » dans Notion |
| L'audio est trop lent à fabriquer | `VOIX_MODELE=fr_FR-gilles-low` dans le YAML, ou `VOIX_MOTEUR=piper` si tu avais mis `kokoro` |
| `Voix indisponible … Phonemes must be one codepoint` | Une voix Piper réentraînée a été téléchargée : redémarre, Brief la refait à la bonne révision |
| `Voix indisponible (Azure …) : 401` | Clé ou région Azure refusée : vérifie `AZURE_SPEECH_KEY` et `AZURE_SPEECH_REGION` (par exemple `francecentral`) |
| `Voix indisponible (Kokoro …)` | `python3` ou `python3-venv` manque, ou le téléchargement du modèle (environ 350 Mo) a échoué : vois le Journal |
| `Audio (URL)` ouvre l'écran de connexion | Normal : l'audio est protégé par le mot de passe de l'appli (connecte-toi d'abord) |
| La page ne s'ouvre pas depuis la 4G | Redirection Freebox (étape 6) ou pare-feu DSM |
| Avertissement de certificat | Étape 5 : le certificat n'est pas associé au port 8447 |
| `fatal: detected dubious ownership` | La ligne `safe.directory` manque dans la commande du YAML |
