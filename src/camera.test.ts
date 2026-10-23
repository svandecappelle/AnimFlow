import { describe, expect, it } from 'vitest';
import { sequenceCycle } from './animation';
import { CAMERA_MAX_ZOOM, cameraAt, cameraKeyframes, cameraSmil } from './camera';
import { createEdge, createNode, emptyDiagram } from './defaults';
import type { Diagram } from './types';

/** Trois boîtes très éloignées reliées en chaîne : a → b → c */
function chain(camera: Diagram['settings']['camera'] = 'close'): Diagram {
  const a = createNode('rectangle', 0, 0, 100, 60);
  const b = createNode('rectangle', 2000, 0, 100, 60);
  const c = createNode('rectangle', 4000, 0, 100, 60);
  const end = (n: typeof a) => ({ nodeId: n.id, x: 0, y: 0 });
  const ab = createEdge(end(a), end(b));
  const bc = createEdge(end(b), end(c));
  bc.animation = { ...bc.animation, delay: 2 };
  return { ...emptyDiagram(), settings: { ...emptyDiagram().settings, sequence: true, camera }, nodes: [a, b, c], edges: [ab, bc] };
}
const VIEW = { width: 1600, height: 900 };
const cx = (b: { minX: number; maxX: number }) => (b.minX + b.maxX) / 2;

describe('caméra de suivi', () => {
  it('inactive hors mode séquence ou désactivée', () => {
    expect(cameraKeyframes(chain('off'), VIEW)).toEqual([]);
    const d = chain();
    expect(cameraKeyframes({ ...d, settings: { ...d.settings, sequence: false } }, VIEW)).toEqual([]);
  });

  it('cadre le lien en cours, puis le suivant, puis la vue d’ensemble, et boucle sans saut', () => {
    const d = chain();
    const keys = cameraKeyframes(d, VIEW);
    const cycle = sequenceCycle(d);
    expect(keys[0].t).toBe(0);
    expect(keys[keys.length - 1].t).toBeCloseTo(cycle);
    keys.slice(1).forEach((k, i) => expect(k.t).toBeGreaterThan(keys[i].t));

    const first = cameraAt(keys, 0.5)!; // flux a → b
    const second = cameraAt(keys, 3)!; // flux b → c
    expect(cx(first)).toBeCloseTo(1050, -1);
    expect(cx(second)).toBeCloseTo(3050, -1);
    // proche : on ne voit pas tout le schéma pendant un flux
    expect(first.maxX - first.minX).toBeLessThan(4100);
    // jamais plus zoomé que CAMERA_MAX_ZOOM
    for (const k of keys) expect(k.b.maxX - k.b.minX).toBeGreaterThanOrEqual(VIEW.width / CAMERA_MAX_ZOOM - 1);

    const end = cameraAt(keys, (3.5 + cycle) / 2)!; // milieu de la pause de fin de cycle : vue d'ensemble
    expect(end.minX).toBeLessThanOrEqual(0);
    expect(end.maxX).toBeGreaterThanOrEqual(4100);
    expect(cameraAt(keys, cycle)).toEqual(cameraAt(keys, 0));
  });

  it('respecte le rapport largeur/hauteur demandé', () => {
    const keys = cameraKeyframes(chain(), { width: 1000, height: 500 });
    for (const { b } of keys) expect((b.maxX - b.minX) / (b.maxY - b.minY)).toBeCloseTo(2);
  });

  it('produit une animation SMIL de viewBox cohérente', () => {
    const keys = cameraKeyframes(chain(), VIEW);
    const smil = cameraSmil(keys)!;
    expect(smil.values.split(';')).toHaveLength(keys.length);
    expect(smil.keyTimes.split(';')).toHaveLength(keys.length);
    expect(smil.keySplines.split(';')).toHaveLength(keys.length - 1);
    expect(smil.keyTimes.startsWith('0;')).toBe(true);
    expect(smil.keyTimes.endsWith(';1')).toBe(true);
  });
});
