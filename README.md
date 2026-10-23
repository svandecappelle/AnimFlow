# AnimFlow

Éditeur de schémas **animés** dans le navigateur, façon Excalidraw (tracé à main levée via rough.js) ou Mermaid (style net),
avec des flux animés le long des liens et un import/export complet.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173 (collaboration incluse)
npm test           # tests (vitest)
npm run build      # build dans dist/
npm start          # production : sert dist/ + le relais de collaboration (PORT, HOST configurables)
```

Pour collaborer à plusieurs machines, exposez le serveur sur le réseau (`npm run dev -- --host`, ou
`HOST=0.0.0.0 PORT=8080 npm start`) et partagez le lien de session. Derrière un proxy HTTPS, le WebSocket `/collab`
doit être transmis ; `VITE_COLLAB_URL` permet aussi de pointer vers un relais hébergé ailleurs.

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
- **Ordre des étapes** (onglet du panneau de droite, touche L) : liste des étapes de la séquence ; glisser un élément sur
  une étape pour qu'il démarre avec elle, ou entre deux étapes pour en créer une. Les formes en apparition « Auto »
  suivent leurs flux. L'étape en cours est surlignée pendant la lecture. « ⚡ Auto » revient à l'ordre calculé d'après
  les flèches.
- **Liens** : « ⇄ Inverser le lien » (Maj+R) et « 🧲 Raccrocher » les extrémités libres aux formes proches (fait
  automatiquement au collage depuis Excalidraw pour les flèches posées contre une forme sans y être liées).
- **Pause entre les animations** : en séquence, temps d'attente entre deux étapes, réglable en direct — le schéma
  est re-minuté en gardant l'enchaînement (branches parallèles, jonctions, notes et apparitions suivent). Pause
  supplémentaire possible avant un flux précis. En boucle : temps de repos entre deux répétitions de chaque animation.
- **Apparition progressive des formes** (fondu ou pop) : en mode séquence, une forme reste cachée jusqu'à l'arrivée
  du premier flux entrant, et les liens qui la touchent apparaissent au démarrage de leur flux. Réglable par forme ou
  pour tout le schéma, et à l'import Mermaid. En pause, les formes masquées sont affichées en contour pointillé.
- **Caméra de suivi** (mode séquence, touche C ou bouton 🎥) : pendant la lecture, la vue cadre les éléments en cours
  d'animation (proche / moyen / large, zoom plafonné à 160 %), puis montre l'ensemble en fin de cycle. Zoomer ou
  déplacer la vue la met en pause ; Lecture, la timeline ou 🎥 la relancent. Le SVG exporté suit la même caméra
  (animation du `viewBox`).
- **Workspaces et documents** (bouton ☰ ou touche B) : plusieurs workspaces, chacun avec plusieurs documents
  (créer, renommer — aussi en cliquant sur le titre —, dupliquer, déplacer, supprimer, rechercher). Chaque document
  garde son historique d'annulation pendant la session. Tout est enregistré dans le navigateur ; un workspace complet
  s'exporte / s'importe en un fichier `.animflow-workspace.json`. « Ouvrir » et le glisser-déposer créent un nouveau
  document.
- **Collaboration en direct** (bouton 👥 Partager) : lien de session `#room=…`, modifications synchronisées en temps
  réel (Yjs), curseurs nommés et sélections des participants, annuler/rétablir limité à ses propres modifications.
  Chaque participant garde une copie dans ses documents ; rouvrir le lien rouvre ce document. Le relais (intégré à
  Vite et à `npm start`) ne garde une session en mémoire que tant qu'un participant est connecté. Le contenu transite
  en clair par le relais : hébergez-le vous-même.
- **Import / export**
  - `.animflow.json` : format natif (Ctrl+S / Ctrl+O, ou glisser-déposer un fichier).
  - **SVG animé** (Ctrl+E) : autonome, lisible dans n'importe quel navigateur, intégrable dans une page ou un wiki ;
    il embarque le schéma source et peut être ré-ouvert dans AnimFlow.
  - **Vidéo** (Ctrl+Maj+E) : MP4, WebM ou GIF animé, rendu image par image dans le navigateur (aucun envoi serveur),
    caméra de suivi comprise. Taille (720p → 4K), images/s, format d'image (16:9, carré, proportions du schéma),
    nombre de cycles en mode séquence. Le MP4 est en H.264 dans Chrome/Edge (AV1 dans Chromium, faute d'encodeur H.264).
  - PNG (image fixe).
  - **Mermaid** : import d'un `flowchart`/`graph` avec mise en page automatique (dagre), export vers Mermaid
    (liens animés exportés en `e1@{ animate: true }`, Mermaid ≥ 11.10). Coller du Mermaid dans le canevas l'importe aussi.
  - **Excalidraw** : copier (Ctrl+C) des éléments sur excalidraw.com puis coller (Ctrl+V) dans AnimFlow les insère sous
    la souris — formes et leurs textes, flèches rattachées (pointes, libellés, courbes, coudes), textes, couleurs et
    styles. Les fichiers `.excalidraw` s'ouvrent aussi (Ouvrir, glisser-déposer). Dessin à main levée, images et
    cadres sont ignorés (un message l'indique).
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
| `src/store.ts` | État global (zustand), historique, sauvegarde auto du document courant |
| `src/workspace.ts` / `src/workspaceActions.ts` | Stockage des workspaces et documents, migration, actions (créer, déplacer, exporter…) |
| `src/geometry.ts` | Tracés des liens (droit, courbe, coudé), points de contour, hit-testing |
| `src/animation.ts` | Timings des animations (boucle / séquence), séquençage automatique |
| `src/camera.ts` | Caméra de suivi : images clés, interpolation, export SMIL du viewBox |
| `src/render/DiagramView.tsx` | Rendu SVG : formes rough.js + animations **SMIL** |
| `src/components/Canvas.tsx` | Interactions de l'éditeur |
| `src/io/files.ts` | Export SVG/PNG/JSON, reconnaissance des fichiers importés |
| `src/collab.ts` / `src/collabEngine.ts` | Collaboration : salles, présence, réplication Yjs du schéma (moteur chargé à la demande) |
| `server/collab.mjs` / `server/serve.mjs` | Relais WebSocket (protocole y-websocket) et serveur de production |
| `src/io/video.ts` | Export vidéo : figement image par image des animations SMIL, encodage WebCodecs (mediabunny) / GIF (gifenc) |
| `src/io/excalidraw.ts` | Conversion du presse-papiers / des fichiers Excalidraw |
| `src/io/mermaid.ts` | Parseur Mermaid flowchart, mise en page dagre, export Mermaid |
| `src/io/mermaidSequence.ts` | Parseur `sequenceDiagram`, rendus « séquence animée » et « schéma en boîtes » |

Les animations sont en SMIL (`<animate>`, `<animateMotion>`) plutôt qu'en CSS : le même balisage sert dans l'éditeur et
dans le SVG exporté, et `pauseAnimations()` / `setCurrentTime()` pilotent tout le schéma (lecture/pause, timeline).
