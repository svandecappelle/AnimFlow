# AnimFlow

Éditeur de schémas **animés** dans le navigateur, façon Excalidraw (tracé à main levée via rough.js) ou Mermaid (style net),
avec des flux animés le long des liens et un import/export complet.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitaires (vitest)
npm run build      # build statique dans dist/
```

## Fonctionnalités

- **Édition** : rectangles, rectangles arrondis, ellipses, losanges, textes, flèches reliées aux formes (elles suivent
  les déplacements). Sélection multiple, redimensionnement, double-clic pour éditer les libellés, annuler/rétablir,
  copier/coller, aimantation (Alt), zoom/pan, sauvegarde automatique dans le navigateur.
- **Animations des liens** : tirets qui défilent, particules, comète, tracé progressif ; durée, délai, sens, couleur,
  nombre/taille des particules.
- **Animations des formes** : pulsation, halo, clignotement.
- **Mode séquence** : les flux jouent l'un après l'autre selon leur délai, puis le cycle recommence. Le bouton
  « Séquencer automatiquement » calcule les délais en suivant le graphe. En séquence, halo et pulsation se déclenchent
  à l'arrivée d'un flux. Timeline cliquable pour se positionner dans le temps.
- **Apparition progressive des formes** (fondu ou pop) : en mode séquence, une forme reste cachée jusqu'à l'arrivée
  du premier flux entrant, et les liens qui la touchent apparaissent au démarrage de leur flux. Réglable par forme ou
  pour tout le schéma, et à l'import Mermaid. En pause, les formes masquées sont affichées en contour pointillé.
- **Import / export**
  - `.animflow.json` : format natif (Ctrl+S / Ctrl+O, ou glisser-déposer un fichier).
  - **SVG animé** (Ctrl+E) : autonome, lisible dans n'importe quel navigateur, intégrable dans une page ou un wiki ;
    il embarque le schéma source et peut être ré-ouvert dans AnimFlow.
  - PNG (image fixe).
  - **Mermaid** : import d'un `flowchart`/`graph` avec mise en page automatique (dagre), export vers Mermaid
    (liens animés exportés en `e1@{ animate: true }`, Mermaid ≥ 11.10). Coller du Mermaid dans le canevas l'importe aussi.
  - **Diagrammes de séquence Mermaid** (`sequenceDiagram`), deux rendus au choix à l'import :
    - *Séquence animée* : participants, lignes de vie, messages qui se dessinent un par un, notes, blocs
      `loop/alt/opt/par/critical/break` (avec `else`), barres d'activation, `autonumber` — tout apparaît dans l'ordre ;
    - *Schéma en boîtes* : un participant = une boîte, un message = un lien numéroté, courbé pour ne pas chevaucher
      les autres ; les flux s'enchaînent dans l'ordre chronologique (notes et blocs non représentés).
    Les messages d'un rendu séquence ont des extrémités libres : déplacer un participant ne déplace pas ses messages
    (sélectionnez tout pour déplacer le diagramme).

## Architecture

| Fichier | Rôle |
| --- | --- |
| `src/types.ts` | Modèle de données (nœuds, liens, réglages) = format du fichier JSON |
| `src/store.ts` | État global (zustand), historique, sauvegarde auto |
| `src/geometry.ts` | Tracés des liens (droit, courbe, coudé), points de contour, hit-testing |
| `src/animation.ts` | Timings des animations (boucle / séquence), séquençage automatique |
| `src/render/DiagramView.tsx` | Rendu SVG : formes rough.js + animations **SMIL** |
| `src/components/Canvas.tsx` | Interactions de l'éditeur |
| `src/io/files.ts` | Export SVG/PNG/JSON, reconnaissance des fichiers importés |
| `src/io/mermaid.ts` | Parseur Mermaid flowchart, mise en page dagre, export Mermaid |
| `src/io/mermaidSequence.ts` | Parseur `sequenceDiagram`, rendus « séquence animée » et « schéma en boîtes » |

Les animations sont en SMIL (`<animate>`, `<animateMotion>`) plutôt qu'en CSS : le même balisage sert dans l'éditeur et
dans le SVG exporté, et `pauseAnimations()` / `setCurrentTime()` pilotent tout le schéma (lecture/pause, timeline).
