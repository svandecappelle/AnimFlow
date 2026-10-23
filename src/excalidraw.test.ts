import { describe, expect, it } from 'vitest';
import { nodeMap, edgeGeometry } from './geometry';
import { parseImportedText } from './io/files';
import { describeSkipped, excalidrawToElements, isExcalidrawData } from './io/excalidraw';

const base = {
  angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
  roughness: 1, opacity: 100, groupIds: [], frameId: null, seed: 1234, version: 3, versionNonce: 1, isDeleted: false,
  boundElements: null, updated: 1, link: null, locked: false,
};

/** Ce que contient le presse-papiers après Ctrl+C sur excalidraw.com */
const clipboard = {
  type: 'excalidraw/clipboard',
  elements: [
    { ...base, id: 'rect', type: 'rectangle', x: 100, y: 100, width: 200, height: 80, roundness: { type: 3 }, backgroundColor: '#a5d8ff', fillStyle: 'hachure',
      boundElements: [{ id: 'rectText', type: 'text' }, { id: 'arrow', type: 'arrow' }] },
    { ...base, id: 'rectText', type: 'text', x: 150, y: 125, width: 100, height: 25, text: 'Service API', originalText: 'Service API', fontSize: 20,
      fontFamily: 5, textAlign: 'center', verticalAlign: 'middle', containerId: 'rect', lineHeight: 1.25 },
    { ...base, id: 'ell', type: 'ellipse', x: 500, y: 90, width: 160, height: 100, roundness: { type: 2 }, backgroundColor: '#ffec99', strokeColor: '#e03131', roughness: 0 },
    { ...base, id: 'dia', type: 'diamond', x: 300, y: 300, width: 120, height: 120, roundness: null, strokeStyle: 'dashed', strokeWidth: 4 },
    { ...base, id: 'arrow', type: 'arrow', x: 302, y: 140, width: 196, height: 0, points: [[0, 0], [196, 0]], roundness: { type: 2 },
      startBinding: { elementId: 'rect', focus: 0, gap: 2 }, endBinding: { elementId: 'ell', focus: 0, gap: 2 },
      startArrowhead: null, endArrowhead: 'arrow', boundElements: [{ id: 'arrowText', type: 'text' }] },
    { ...base, id: 'arrowText', type: 'text', x: 370, y: 130, width: 60, height: 20, text: 'appelle', originalText: 'appelle', fontSize: 16,
      fontFamily: 2, containerId: 'arrow' },
    { ...base, id: 'curve', type: 'arrow', x: 0, y: 400, width: 200, height: 50, points: [[0, 0], [100, -50], [200, 0]], startBinding: null,
      endBinding: null, startArrowhead: 'dot', endArrowhead: 'triangle' },
    { ...base, id: 'elbow', type: 'arrow', elbowed: true, x: 360, y: 300, width: 100, height: 150, points: [[0, 0], [0, -75], [200, -75], [200, -150]],
      startBinding: { elementId: 'dia' }, endBinding: { elementId: 'ell' }, startArrowhead: null, endArrowhead: 'arrow' },
    { ...base, id: 'line', type: 'line', x: 0, y: 600, width: 300, height: 0, points: [[0, 0], [300, 0]], strokeStyle: 'dotted', startArrowhead: null, endArrowhead: null },
    { ...base, id: 'title', type: 'text', x: 100, y: 20, width: 240, height: 35, text: 'Architecture', fontSize: 28, fontFamily: 3, containerId: null },
    { ...base, id: 'draw', type: 'freedraw', x: 0, y: 0, width: 10, height: 10, points: [[0, 0], [10, 10]] },
    { ...base, id: 'img', type: 'image', x: 0, y: 0, width: 10, height: 10, fileId: 'f1' },
    { ...base, id: 'gone', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: true },
  ],
  files: {},
};

describe('import Excalidraw', () => {
  const r = excalidrawToElements(clipboard);
  const node = (label: string) => r.nodes.find((n) => n.label === label)!;

  it('reconnaît le presse-papiers et les fichiers .excalidraw', () => {
    expect(isExcalidrawData(clipboard)).toBe(true);
    expect(isExcalidrawData({ type: 'excalidraw', version: 2, elements: [] })).toBe(true);
    expect(isExcalidrawData({ type: 'animflow/clipboard', nodes: [] })).toBe(false);
  });

  it('convertit les formes, leur texte lié et leurs styles', () => {
    expect(r.nodes).toHaveLength(4); // rectangle, ellipse, losange, titre (textes liés absorbés, supprimé ignoré)
    const api = node('Service API');
    expect(api).toMatchObject({ shape: 'rounded', x: 100, y: 100, width: 200, height: 80, fillColor: '#a5d8ff', fillStyle: 'hachure', fontFamily: 'hand', seed: 1234 });
    const ell = r.nodes.find((n) => n.shape === 'ellipse')!;
    expect(ell).toMatchObject({ strokeColor: '#e03131', roughness: 0, fillStyle: 'solid', fillColor: '#ffec99' });
    expect(r.nodes.find((n) => n.shape === 'diamond')).toMatchObject({ fillStyle: 'none', strokeWidth: 4 });
    expect(node('Architecture')).toMatchObject({ shape: 'text', fontFamily: 'mono', fontSize: 28 });
  });

  it('rattache les flèches aux formes, avec pointes, libellé, courbe et coude', () => {
    expect(r.edges).toHaveLength(4);
    const [arrow, curve, elbow, line] = r.edges;
    expect(arrow.source.nodeId).toBe(node('Service API').id);
    expect(arrow.target.nodeId).toBe(r.nodes.find((n) => n.shape === 'ellipse')!.id);
    expect(arrow).toMatchObject({ label: 'appelle', arrowHeads: 'end', fontFamily: 'sans', routing: 'straight' });
    expect(arrow.animation.type).toBe('none');

    expect(curve).toMatchObject({ arrowHeads: 'both', routing: 'curved' });
    expect(curve.source.nodeId).toBeUndefined();
    // la courbe passe par le point du milieu d'Excalidraw (100, 350)
    const g = edgeGeometry(curve, nodeMap(r.nodes));
    expect(g.mid.x).toBeCloseTo(100, 0);
    expect(g.mid.y).toBeCloseTo(350, 0);

    expect(elbow.routing).toBe('elbow');
    expect(elbow.source.nodeId).toBe(r.nodes.find((n) => n.shape === 'diamond')!.id);
    expect(line).toMatchObject({ arrowHeads: 'none', strokeStyle: 'dotted', source: { x: 0, y: 600 }, target: { x: 300, y: 600 } });
  });

  it('signale les éléments ignorés', () => {
    expect(r.skipped).toEqual({ freedraw: 1, image: 1 });
    expect(describeSkipped(r.skipped)).toBe('1 dessin à main levée, 1 image ignorés (sans équivalent dans AnimFlow)');
    expect(describeSkipped({ freedraw: 2 })).toBe('2 dessins à main levée ignorés (sans équivalent dans AnimFlow)');
    expect(describeSkipped({})).toBeNull();
  });

  it('ouvre un fichier .excalidraw comme un schéma (avec son fond)', () => {
    const parsed = parseImportedText(JSON.stringify({ ...clipboard, type: 'excalidraw', version: 2, appState: { viewBackgroundColor: '#fff9db' } }));
    expect(parsed.kind).toBe('diagram');
    if (parsed.kind !== 'diagram') return;
    expect(parsed.diagram.nodes).toHaveLength(4);
    expect(parsed.diagram.settings.background).toBe('#fff9db');
    expect(parsed.notice).toContain('ignorés');
  });
});
