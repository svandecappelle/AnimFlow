import { autoSequence } from './animation';
import { createNode, emptyDiagram } from './defaults';
import { mermaidToElements } from './io/mermaid';
import type { Diagram, EdgeAnimationType } from './types';

export const EXAMPLE_MERMAID = `flowchart LR
    U((Utilisateur)) -->|requête| W[Application Web]
    W --> G{API Gateway}
    G -->|auth| A(Service Auth)
    G -->|commande| O(Service Commandes)
    O --> DB[(Base de données)]
    O -.->|événement| Q[[File de messages]]
    Q --> N(Notifications)`;

export const EXAMPLE_SEQUENCE = `sequenceDiagram
    autonumber
    actor U as Utilisateur
    participant W as Application Web
    participant A as Service Auth
    participant API as API Commandes
    participant DB as Base de données
    U->>W: Se connecter
    W->>+A: Vérifier identifiants
    A-->>-W: Jeton JWT
    Note over W,A: Jeton valide 15 min
    U->>W: Passer commande
    W->>+API: POST /commandes
    alt Stock disponible
        API->>DB: Enregistrer
        DB-->>API: OK
        API-->>W: 201 Créée
    else Rupture
        API-->>W: 409 Indisponible
    end
    deactivate API
    loop Toutes les 5 s
        W->>API: Statut ?
    end
    W-->>U: Confirmation`;

/** Diagramme de démonstration affiché au premier lancement. */
export function createExampleDiagram(): Diagram {
  const { nodes, edges } = mermaidToElements(EXAMPLE_MERMAID, {
    animation: 'particles',
    roughness: 1,
    routing: 'curved',
    origin: { x: 80, y: 140 },
  });
  const anims: EdgeAnimationType[] = ['particles', 'flow', 'comet', 'particles', 'flow', 'comet', 'draw'];
  const colors = ['#1971c2', '#1971c2', '#2f9e44', '#e03131', '#9c36b5', '#f08c00', '#f08c00'];
  edges.forEach((e, i) => {
    e.animation = { ...e.animation, type: anims[i] ?? 'flow', color: colors[i] ?? null, duration: 1.2 };
  });
  nodes.forEach((n) => {
    if (n.shape === 'diamond') n.animation = 'glow';
    if (n.label === 'Notifications' || n.label === 'Base de données') n.animation = 'pulse';
    n.reveal = 'pop';
  });
  const title = createNode('text', 80, 50, 640, 40, {
    label: 'AnimFlow — double-cliquez pour éditer, outil flèche (A) pour relier',
    fontSize: 24,
    textColor: '#495057',
  });
  return autoSequence({ ...emptyDiagram(), nodes: [title, ...nodes], edges });
}
