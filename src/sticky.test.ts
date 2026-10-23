import { describe, expect, it } from 'vitest';
import { autoSequence } from './animation';
import { createEdge, createNode, emptyDiagram } from './defaults';
import { EXAMPLE_SEQUENCE } from './example';
import { edgeGeometry, nodeMap, REPEAT_SPACING, repeatPositions } from './geometry';
import { exportSvgString } from './io/files';
import { sequenceToElements } from './io/mermaidSequence';
import { stickyVisible, STICKY } from './sticky';
import type { Diagram } from './types';

const fakeCanvas = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  svg.firstElementChild!.setAttribute('class', 'af-content');
  return svg as SVGSVGElement;
};

/** Diagramme de séquence long (beaucoup de messages) */
function longSequence(camera: Diagram['settings']['camera']): Diagram {
  const src = ['sequenceDiagram', 'participant A as Client', 'participant B as Serveur', ...Array.from({ length: 30 }, (_, i) => `A->>B: message ${i + 1}`)].join('\n');
  const r = sequenceToElements(src, { render: 'sequence', animation: 'draw', roughness: 1, reveal: true, origin: { x: 0, y: 0 } });
  return { ...emptyDiagram(), nodes: r.nodes, edges: r.edges, settings: { ...emptyDiagram().settings, ...r.settings, camera } };
}

describe('colonnes des diagrammes de séquence', () => {
  it('l’import marque les participants en en-têtes collants et les lignes de vie avec rappel du nom', () => {
    const r = sequenceToElements(EXAMPLE_SEQUENCE, { render: 'sequence', animation: 'draw', roughness: 1, reveal: true, origin: { x: 0, y: 0 } });
    const sticky = r.nodes.filter((n) => n.sticky).map((n) => n.label);
    expect(sticky).toEqual(['Utilisateur', 'Application Web', 'Service Auth', 'API Commandes', 'Base de données']);
    const lifelines = r.edges.filter((e) => e.repeatLabel);
    expect(lifelines).toHaveLength(5);
    expect(lifelines.every((e) => e.source.nodeId && r.nodes.find((n) => n.id === e.source.nodeId)?.sticky)).toBe(true);
  });

  it('rappels du nom tous les 400 px, aucun sur un lien court', () => {
    const a = createNode('rectangle', 0, 0, 100, 50);
    const long = createEdge({ nodeId: a.id, x: 0, y: 0 }, { x: 50, y: 2000 });
    const pts = repeatPositions(edgeGeometry(long, nodeMap([a])));
    expect(pts.length).toBeGreaterThanOrEqual(4);
    expect(pts[1].y - pts[0].y).toBeCloseTo(REPEAT_SPACING);
    const short = createEdge({ x: 0, y: 0 }, { x: 0, y: 300 });
    expect(repeatPositions(edgeGeometry(short, nodeMap([])))).toHaveLength(0);
  });

  it('les rappels évitent les liens qui croisent et les libellés', () => {
    const a = createNode('rectangle', 0, 0, 100, 50);
    const lifeline = edgeGeometry(createEdge({ nodeId: a.id, x: 0, y: 0 }, { x: 50, y: 1200 }), nodeMap([a]));
    const free = repeatPositions(lifeline);
    // un message horizontal passe exactement sur le 1er rappel prévu, un libellé sur le 2e
    const blockedY = free[0].y;
    const label = { minX: 0, maxX: 100, minY: free[1].y - 10, maxY: free[1].y + 10 };
    const placed = repeatPositions(lifeline, { width: 80, height: 20 }, { lines: [[{ x: -200, y: blockedY }, { x: 300, y: blockedY }]], boxes: [label] });
    expect(placed).toHaveLength(free.length);
    expect(Math.abs(placed[0].y - blockedY)).toBeGreaterThanOrEqual(10);
    expect(placed[1].y > label.maxY + 9 || placed[1].y < label.minY - 9).toBe(true);
  });

  it('visibilité : seulement quand la forme est sortie par le haut', () => {
    const n = createNode('rectangle', 0, 0, 100, 60);
    expect(stickyVisible(n, -100, 1)).toBe(false);
    expect(stickyVisible(n, 200, 1)).toBe(true);
    // zoomé ×2 (0,5 unité par pixel) : le bandeau occupe moins de place dans le schéma
    expect(stickyVisible(n, 60 - (STICKY.margin + STICKY.height) * 0.5 + 1, 0.5)).toBe(true);
  });

  it('SVG exporté : en-têtes animés avec la caméra, absents sans caméra', () => {
    const withCam = exportSvgString(longSequence('veryClose'), fakeCanvas());
    const doc = new DOMParser().parseFromString(withCam, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull(); // XML valide (pas d'attribut en double)
    const group = doc.querySelector('.af-sticky')!;
    expect(group).not.toBeNull();
    expect(group.textContent).toContain('Client');
    expect(group.textContent).toContain('Serveur');
    const opacity = group.querySelector('animate[attributeName="opacity"]')!.getAttribute('values')!.split(';');
    expect(opacity).toContain('0'); // cachés au début (participants visibles)
    expect(opacity).toContain('0.95'); // montrés quand la caméra descend
    expect(group.querySelectorAll('animateTransform[type="scale"]').length).toBe(2);

    expect(exportSvgString(longSequence('off'), fakeCanvas())).not.toContain('af-sticky');
    const flow = autoSequence({ ...emptyDiagram(), nodes: [createNode('rectangle', 0, 0, 100, 50, { label: 'X' })], edges: [] });
    expect(exportSvgString({ ...flow, settings: { ...flow.settings, camera: 'close' } }, fakeCanvas())).not.toContain('af-sticky');
  });
});
