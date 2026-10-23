import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEdge, createNode, emptyDiagram } from './defaults';
import { EXAMPLE_SEQUENCE } from './example';
import { sequenceToElements } from './io/mermaidSequence';
import type { Diagram } from './types';

/** Diagramme de séquence tel qu'importé avant l'ajout des options de colonnes */
function legacySequence(): Diagram {
  const r = sequenceToElements(EXAMPLE_SEQUENCE, { render: 'sequence', animation: 'draw', roughness: 1, reveal: true, origin: { x: 0, y: 0 } });
  const strip = <T extends { sticky?: boolean; repeatLabel?: boolean }>(o: T) => {
    const { sticky, repeatLabel, ...rest } = o;
    void sticky;
    void repeatLabel;
    return rest as T;
  };
  return { ...emptyDiagram(), nodes: r.nodes.map(strip), edges: r.edges.map(strip), settings: { ...emptyDiagram().settings, ...r.settings } };
}

/** Schéma dessiné à la main, avec un lien pointillé sans pointe (ne doit pas être pris pour une ligne de vie) */
function handDrawn(): Diagram {
  const a = createNode('rectangle', 0, 0, 100, 60, { label: 'A' });
  const e = createEdge({ nodeId: a.id, x: 50, y: 30 }, { x: 50, y: 400 }, { strokeStyle: 'dashed', arrowHeads: 'none' });
  return { ...emptyDiagram(), nodes: [a], edges: [e] };
}

function seed(docs: Record<string, Diagram>, migrations?: string[]) {
  localStorage.clear();
  const metas = Object.entries(docs).map(([id, d]) => ({ id, name: id, updatedAt: 1, nodes: d.nodes.length, edges: d.edges.length }));
  for (const [id, d] of Object.entries(docs)) localStorage.setItem(`animflow:doc:${id}`, JSON.stringify(d));
  localStorage.setItem(
    'animflow:workspaces',
    JSON.stringify({ version: 1, workspaces: [{ id: 'w1', name: 'Perso', docs: metas }], currentWorkspaceId: 'w1', currentDocId: metas[0].id, migrations }),
  );
}
const doc = (id: string) => JSON.parse(localStorage.getItem(`animflow:doc:${id}`)!) as Diagram;

async function boot() {
  vi.resetModules();
  return (await import('./store')).useStore.getState();
}

beforeEach(() => localStorage.clear());

describe('activation des colonnes sur les diagrammes déjà importés', () => {
  it('active en-têtes collants et rappels sur tous les diagrammes de séquence, une seule fois', async () => {
    seed({ seq1: legacySequence(), seq2: legacySequence(), dessin: handDrawn() });
    const s = await boot();
    for (const id of ['seq1', 'seq2']) {
      const d = doc(id);
      expect(d.nodes.filter((n) => n.sticky).map((n) => n.label)).toEqual(['Utilisateur', 'Application Web', 'Service Auth', 'API Commandes', 'Base de données']);
      expect(d.edges.filter((e) => e.repeatLabel)).toHaveLength(5);
      // rien d'autre n'est touché : notes, cadres, messages
      expect(d.nodes.filter((n) => n.sticky).every((n) => n.shape !== 'text')).toBe(true);
      expect(d.edges.filter((e) => e.animation.type !== 'none').every((e) => !e.repeatLabel)).toBe(true);
    }
    expect(doc('dessin').edges[0].repeatLabel).toBeUndefined();
    expect(doc('dessin').nodes[0].sticky).toBeUndefined();
    // le document ouvert est déjà à jour en mémoire, et l'utilisateur est prévenu
    expect(s.diagram.nodes.some((n) => n.sticky)).toBe(true);
    expect(s.toast).toContain('2 diagrammes');

    // l'utilisateur désactive une option : elle n'est pas réactivée au chargement suivant
    const d = doc('seq1');
    d.nodes = d.nodes.map((n) => (n.sticky ? { ...n, sticky: false } : n));
    localStorage.setItem('animflow:doc:seq1', JSON.stringify(d));
    const again = await boot();
    expect(doc('seq1').nodes.some((n) => n.sticky)).toBe(false);
    expect(again.toast).toBeNull();
  });

  it('ne fait rien (ni message) s’il n’y a pas de diagramme de séquence', async () => {
    seed({ dessin: handDrawn() });
    const s = await boot();
    expect(s.toast).toBeNull();
    expect(JSON.parse(localStorage.getItem('animflow:workspaces')!).migrations).toContain('sequence-columns');
  });
});
