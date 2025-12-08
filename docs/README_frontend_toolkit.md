# Frontend Toolkit (Tailwind CSS)

## Vue d'ensemble

L'interface utilisateur est construite avec **Tailwind CSS**, un framework CSS utility-first qui permet de créer rapidement des designs personnalisés sans quitter le HTML.

### Glossaire

- **Frontend** : La partie visible d'une application web qui s'exécute dans le navigateur de l'utilisateur (interface, animations, interactions)
- **Tailwind CSS** : Un framework CSS qui fournit des classes utilitaires prédéfinies pour styliser les éléments sans écrire de CSS personnalisé
- **CSS (Cascading Style Sheets)** : Le langage qui définit l'apparence visuelle des pages web (couleurs, tailles, positions, etc.)
- **Utility-first** : Une approche où on utilise de petites classes réutilisables plutôt que d'écrire du CSS personnalisé pour chaque composant
- **HTML** : Le langage de structure qui définit le contenu et l'organisation d'une page web

## Caractéristiques principales

- **Utility-first** : Classes CSS atomiques pour un contrôle précis du style
- **Responsive design** : Adaptation automatique à tous les écrans
- **Customisation** : Configuration centralisée des couleurs, espacements, etc.
- **Performance** : CSS optimisé et minifié en production

### Définitions des caractéristiques

- **Classes atomiques** : De petites classes CSS qui font une seule chose (ex: `text-red-500` pour la couleur, `p-4` pour le padding)
- **Responsive design** : Une conception qui s'adapte automatiquement à différentes tailles d'écran (mobile, tablette, desktop)
- **Breakpoint** : Un point de rupture qui définit quand le design change selon la taille de l'écran (ex: sur mobile afficher une colonne, sur desktop trois colonnes)
- **Production** : L'environnement final où l'application est accessible aux utilisateurs (opposé à développement)
- **Minification** : Processus qui réduit la taille d'un fichier en supprimant espaces, commentaires et caractères inutiles pour accélérer le chargement

## Configuration

Le fichier `tailwind.config.js` définit :
- Palette de couleurs personnalisée
- Breakpoints responsive
- Extensions de classes utilitaires
- Purge CSS pour optimiser la taille du bundle

### Définitions de configuration

- **Fichier de configuration** : Un fichier (ici `tailwind.config.js`) qui centralise les paramètres personnalisés du framework
- **Palette de couleurs** : L'ensemble des couleurs disponibles dans le projet, définies avec des noms cohérents (ex: primary, secondary, danger)
- **Extension de classes** : Ajout de nouvelles classes utilitaires personnalisées en plus de celles fournies par défaut
- **Purge CSS** : Un processus qui supprime toutes les classes CSS non utilisées du fichier final pour réduire sa taille
- **Bundle** : Le fichier final regroupant tout le code CSS nécessaire pour l'application

## Technologies utilisées

- **Tailwind CSS** : Framework CSS
- **TypeScript** : Pour les composants dynamiques
- **PostCSS** : Traitement et optimisation CSS

### Définitions des technologies

- **Composant dynamique** : Un élément d'interface qui peut changer son apparence ou son comportement selon les actions de l'utilisateur ou les données reçues
- **PostCSS** : Un outil qui transforme et optimise le CSS à travers des plugins (ajout de préfixes navigateurs, minification, etc.)

## Avantages de Tailwind

1. **Développement rapide** : Pas besoin d'écrire de CSS personnalisé
2. **Consistance** : Design system unifié sur toute l'application
3. **Maintenabilité** : Styles colocalisés avec le markup
4. **Petite taille** : Seules les classes utilisées sont incluses

### Définitions des avantages

- **Design system** : Un ensemble cohérent de règles de design (couleurs, espacements, typographie) appliqué uniformément dans toute l'application
- **Maintenabilité** : La facilité avec laquelle on peut modifier et maintenir le code dans le temps
- **Colocalisation** : Le fait de placer les styles directement dans le HTML plutôt que dans des fichiers CSS séparés, facilitant la compréhension et la modification
- **Markup** : Le code HTML qui structure le contenu de la page

## Exemple d'utilisation

```html
<div class="flex items-center justify-center min-h-screen bg-gray-900">
  <button class="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg">
    Jouer
  </button>
</div>
```

### Explications de l'exemple

- **flex** : Active le mode flexbox pour organiser les éléments de manière flexible
- **items-center** : Centre les éléments verticalement dans le conteneur
- **justify-center** : Centre les éléments horizontalement dans le conteneur
- **min-h-screen** : Hauteur minimum égale à la hauteur de l'écran (100vh)
- **bg-gray-900** : Couleur de fond gris très foncé
- **px-6** : Padding horizontal de 1.5rem (24px)
- **py-3** : Padding vertical de 0.75rem (12px)
- **hover:bg-blue-600** : Change la couleur de fond au survol de la souris
- **rounded-lg** : Applique des coins arrondis larges au bouton

## Structure des styles

- Classes utilitaires pour la mise en page
- Composants réutilisables via `@apply`
- Animations et transitions fluides
- Dark mode natif

### Définitions de structure

- **Mise en page/Layout** : L'organisation et le positionnement des éléments sur la page (grille, colonnes, espacement)
- **@apply** : Une directive Tailwind qui permet de regrouper plusieurs classes utilitaires dans une seule classe CSS personnalisée
- **Transition** : Un effet visuel progressif lors du changement d'état d'un élément (ex: changement de couleur en douceur sur 300ms)
- **Animation** : Un mouvement ou changement visuel répété ou contrôlé (rotation, déplacement, pulsation)
- **Dark mode** : Un thème sombre pour l'interface qui inverse les couleurs (fond sombre, texte clair) pour réduire la fatigue oculaire
- **Padding** : L'espace intérieur entre le contenu d'un élément et ses bordures
- **Flexbox** : Un système de mise en page CSS qui facilite l'alignement et la distribution d'éléments dans un conteneur
