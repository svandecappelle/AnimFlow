import { describe, expect, it } from 'vitest';
import { autoSequence, discreteVisibility, linearKeys, revealTimes, sequenceCycle } from './animation';
import { createEdge, createNode, emptyDiagram, normalizeDiagram } from './defaults';
import { boundaryPoint, edgeGeometry, nodeMap } from './geometry';
import { parseImportedText } from './io/files';
import { diagramToMermaid, mermaidToElements, parseMermaid } from './io/mermaid';

describe('parseMermaid', () => {
  it('parse formes, liens, libellés et chaînes', () => {
    const g = parseMermaid(`graph TD
      A[Début] -->|oui| B{Choix}; B -- non --> C((Fin))
      B -.-> D(Arrondi) ==> E
      C --- A
      F & G --> H`);
    expect(g.direction).toBe('TB');
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(byId.A).toMatchObject({ label: 'Début', shape: 'rectangle' });
    expect(byId.B.shape).toBe('diamond');
    expect(byId.C.shape).toBe('ellipse');
    expect(byId.D.shape).toBe('rounded');
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'A', to: 'B', label: 'oui', arrowHeads: 'end' }));
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'B', to: 'C', label: 'non' }));
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'B', to: 'D', style: 'dashed' }));
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'D', to: 'E', style: 'thick' }));
    expect(g.edges).toContainEqual(expect.objectContaining({ from: 'C', to: 'A', arrowHeads: 'none' }));
    expect(g.edges.filter((e) => e.to === 'H')).toHaveLength(2);
  });

  it('lit les identifiants de liens animés (Mermaid 11.10)', () => {
    const g = parseMermaid(`flowchart LR
      A e1@--> B
      e1@{ animation: fast }`);
    expect(g.edges[0]).toMatchObject({ id: 'e1', animate: 'fast' });
  });

  it('refuse les autres types de diagrammes', () => {
    expect(() => parseMermaid('sequenceDiagram\nA->>B: hi')).toThrow();
  });
});

describe('mermaid ↔ éléments', () => {
  it('aller-retour', () => {
    const src = 'flowchart LR\n A[Un] --> B(Deux)\n B -.->|ok| C{Trois}';
    const { nodes, edges } = mermaidToElements(src, { animation: 'flow', roughness: 1, routing: 'straight', origin: { x: 0, y: 0 } });
    expect(nodes).toHaveLength(3);
    expect(edges.every((e) => e.source.nodeId && e.target.nodeId)).toBe(true);
    const back = parseMermaid(diagramToMermaid(nodes, edges));
    expect(back.nodes.map((n) => n.label).sort()).toEqual(['Deux', 'Trois', 'Un']);
    expect(back.edges).toHaveLength(2);
    expect(back.edges.find((e) => e.label === 'ok')?.style).toBe('dashed');
    expect(back.edges.every((e) => e.animate)).toBe(true);
  });
});

describe('animation', () => {
  it('linearKeys supprime les bornes inutiles', () => {
    expect(linearKeys(5, 5, 0, 0, 0, 1)).toEqual({ values: '5;0', keyTimes: '0;1' });
    expect(linearKeys(5, 5, 0, 0, 0.25, 0.5)).toEqual({ values: '5;5;0;0', keyTimes: '0;0.25;0.5;1' });
  });

  it('discreteVisibility', () => {
    expect(discreteVisibility([[0, 1]])).toBe(1);
    expect(discreteVisibility([[0.2, 0.4]])).toEqual({ values: '0;1;0', keyTimes: '0;0.2;0.4' });
    expect(discreteVisibility([[0, 0.5]])).toEqual({ values: '1;0', keyTimes: '0;0.5' });
  });

  it('autoSequence enchaîne les liens le long du graphe, y compris avec un cycle', () => {
    const a = createNode('rectangle', 0, 0);
    const b = createNode('rectangle', 300, 0);
    const c = createNode('rectangle', 600, 0);
    const end = (n: typeof a) => ({ nodeId: n.id, x: 0, y: 0 });
    const e1 = createEdge(end(a), end(b));
    const e2 = createEdge(end(b), end(c));
    const back = createEdge(end(c), end(a));
    const d = autoSequence({ ...emptyDiagram(), nodes: [a, b, c], edges: [e1, e2, back] }, 0);
    const delay = (id: string) => d.edges.find((e) => e.id === id)!.animation.delay;
    expect(d.settings.sequence).toBe(true);
    expect(delay(e1.id)).toBe(0);
    expect(delay(e2.id)).toBe(1.5);
    expect(delay(back.id)).toBe(3);
    expect(sequenceCycle(d)).toBe(4.5 + d.settings.sequenceGap);
  });
});

describe('apparition progressive', () => {
  it('une forme apparaît à l’arrivée du premier flux, ses liens au démarrage de leur flux', () => {
    const a = createNode('rectangle', 0, 0, 100, 50, { reveal: 'pop' });
    const b = createNode('rectangle', 300, 0, 100, 50, { reveal: 'pop' });
    const c = createNode('rectangle', 600, 0, 100, 50, { reveal: 'fade' });
    const plain = createNode('rectangle', 0, 300, 100, 50);
    const end = (n: typeof a) => ({ nodeId: n.id, x: 0, y: 0 });
    const ab = createEdge(end(a), end(b));
    const bc = createEdge(end(b), end(c));
    const ac = createEdge(end(a), end(c));
    ac.animation = { ...ac.animation, duration: 10 }; // plus lent : c doit apparaître via b
    const back = createEdge(end(c), end(a)); // cycle : a reste une source visible dès le début
    const toPlain = createEdge(end(c), end(plain), { animation: { ...ab.animation, type: 'none' } });
    const d = autoSequence({ ...emptyDiagram(), nodes: [a, b, c, plain], edges: [ab, bc, ac, back, toPlain] }, 0);
    const r = revealTimes(d);
    expect(r.nodes.has(a.id)).toBe(false);
    expect(r.nodes.get(b.id)).toBe(1.5);
    expect(r.nodes.get(c.id)).toBe(3);
    expect(r.nodes.has(plain.id)).toBe(false); // pas d'option reveal
    expect(r.edges.has(ab.id)).toBe(false); // démarre à 0
    expect(r.edges.get(bc.id)).toBe(1.5);
    expect(r.edges.get(toPlain.id)).toBe(3); // non animé : visible avec sa source
  });
});

describe('géométrie', () => {
  it('le point de contour est sur le bord du rectangle et de l’ellipse', () => {
    const r = createNode('rectangle', 0, 0, 100, 50);
    expect(boundaryPoint(r, { x: 500, y: 25 })).toEqual({ x: 100, y: 25 });
    const el = createNode('ellipse', 0, 0, 100, 50);
    const p = boundaryPoint(el, { x: 50, y: 500 });
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(50);
  });

  it('un lien coudé a des segments orthogonaux', () => {
    const a = createNode('rectangle', 0, 0, 100, 50);
    const b = createNode('rectangle', 300, 200, 100, 50);
    const e = createEdge({ nodeId: a.id, x: 0, y: 0 }, { nodeId: b.id, x: 0, y: 0 }, { routing: 'elbow' });
    const g = edgeGeometry(e, nodeMap([a, b]));
    for (let i = 1; i < g.points.length; i++) {
      const [p, q] = [g.points[i - 1], g.points[i]];
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
  });
});

describe('import', () => {
  it('normalise un JSON incomplet et retire les références cassées', () => {
    const d = normalizeDiagram({
      nodes: [{ id: 'a', shape: 'ellipse', x: 1, y: 2 }],
      edges: [{ id: 'e', source: { nodeId: 'a' }, target: { nodeId: 'zz', x: 5, y: 6 } }],
    });
    expect(d.nodes[0]).toMatchObject({ id: 'a', shape: 'ellipse', width: expect.any(Number) });
    expect(d.edges[0].source.nodeId).toBe('a');
    expect(d.edges[0].target).toEqual({ nodeId: undefined, x: 5, y: 6 });
    expect(d.edges[0].animation.type).toBe('flow');
  });

  it('reconnaît JSON, SVG AnimFlow et Mermaid', () => {
    const d = { ...emptyDiagram(), nodes: [createNode('rectangle', 0, 0, 10, 10, { label: 'é ✓' })] };
    expect(parseImportedText(JSON.stringify(d)).kind).toBe('diagram');
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d))));
    const svg = parseImportedText(`<svg><metadata>animflow:${b64}</metadata></svg>`);
    expect(svg.kind === 'diagram' && svg.diagram.nodes[0].label).toBe('é ✓');
    expect(parseImportedText('%% commentaire\ngraph LR\nA-->B').kind).toBe('mermaid');
    expect(() => parseImportedText('<svg></svg>')).toThrow();
  });
});
