// Mode démo (pas de NOTION_TOKEN) : une « base Notion » en mémoire, avec quelques briefs fictifs,
// pour voir l'appli et essayer la voix sans rien connecter. Même interface que notion.js.
// Les textes sont inventés. Les modifications faites par l'appli (Audio prêt) ne durent que jusqu'à l'arrêt du serveur.
const { blocsDepuisMarkdown } = require('./parseur');
const { parisDe, ajouterJours, dateLisible } = require('./temps');

const TEXTE = (jour) => `## Ta journée

Bonjour, nous sommes ${jour}. Voici ton brief du matin, une démonstration avec des informations inventées.

Ce midi, rien n'est prévu dans ton planning. Ce soir, c'est un gratin de courgettes. Pour les courses, il manque du riz et des tomates. Côté tâches, une seule est à rendre aujourd'hui : finir la page d'accueil du projet. Côté mails, une invitation à un atelier jeudi, et une facture à vérifier.

Sources :

- Notion

## Actu France et monde

Pour l'actualité, commençons par la France. Le gouvernement a présenté son calendrier pour les prochaines semaines, avec un budget attendu à vingt-trois heures trente de débats. Les discussions continuent à l'Assemblée, et le vote est attendu pour la fin du mois.

Dans le monde, un sommet réunit dix-huit pays pour parler d'énergie. Les participants veulent doubler la part du renouvelable d'ici dix ans, soit plus de quarante pour cent de l'électricité.

Sources :

- [Le calendrier du budget (Exemple Info)](https://example.org/budget)
- [Sommet sur l'énergie (Exemple Monde)](https://example.org/energie)

## IA et tech

Passons à l'IA et la tech. Une équipe de chercheurs publie un modèle libre capable de tourner sur un simple ordinateur portable. Il coûte moins de cinq euros par mois à héberger, et il est déjà testé par des centaines de développeurs.

Sources :

- [Un modèle libre pour ordinateur portable (Exemple Tech)](https://example.org/modele)

## Sport, jeux vidéo et culture

Place au sport. Hier soir, l'équipe locale s'est imposée trois à un, et prend la tête du classement. Côté jeux vidéo, un petit studio indépendant sort demain un jeu de plateforme très attendu. Voilà pour ce matin. Bonne journée !

Sources :

- [Résumé du match (Exemple Sport)](https://example.org/match)
- [Sorties de la semaine (Exemple Jeux)](https://example.org/jeux)
`;

function creer(maintenant = () => new Date()) {
  const aujourdhui = parisDe(maintenant()).date;
  const defs = [
    [0, 'Script prêt', ['Perso', 'Actu France', 'Actu monde', 'IA et tech', 'Sport', 'Jeux vidéo']],
    [1, 'Script prêt', ['Perso', 'Actu France', 'IA et tech', 'Sport']],
    [2, 'Script prêt', ['Perso', 'Actu monde', 'IA et tech', 'Culture']],
    [40, 'Audio prêt', ['Perso', 'Actu France', 'Sport']],
  ];
  const pages = defs.map(([decalage, statut, sujets], i) => {
    const date = ajouterJours(aujourdhui, -decalage);
    const corps = blocsDepuisMarkdown(TEXTE(dateLisible(date)));
    const mots = corps.filter((b) => b.type === 'para').reduce((n, b) => n + b.texte.split(/\s+/).length, 0);
    return {
      id: `demo-${date}`, titre: `Brief du ${dateLisible(date)}`, date, cree: `${date}T04:21:00.000Z`, modifie: `${date}T04:21:00.000Z`,
      statut, audioUrl: statut === 'Audio prêt' ? `http://localhost/audio/${date}.mp3` : null, mots, dureeMin: Math.round(mots / 150 * 10) / 10, sujets, corps, i,
    };
  });
  const sansCorps = ({ corps, i, ...p }) => p;
  return {
    actif: () => false,
    demo: true,
    async listerBriefs() { return pages.map(sansCorps); },
    async lireCorps(id) { return pages.find((p) => p.id === id)?.corps ?? []; },
    async lirePage(id) { return sansCorps(pages.find((p) => p.id === id)); },
    async marquerAudioPret(id, url) {
      const p = pages.find((x) => x.id === id);
      Object.assign(p, { audioUrl: url, statut: 'Audio prêt', modifie: new Date().toISOString() });
      return sansCorps(p);
    },
    STATUT_SCRIPT: 'Script prêt',
    STATUT_AUDIO: 'Audio prêt',
  };
}

module.exports = { creer };
