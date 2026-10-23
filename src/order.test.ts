import { describe, expect, it } from 'vitest';
import { applyStepOrder, autoSequence, REVEAL_DURATION, retime, sequenceSteps, stepHoldTime, stepNote, withStepNote } from './animation';
import { createEdge, createNode, emptyDiagram } from './defaults';
import { edgeGeometry, nodeMap, reverseEdge, snapEdge } from './geometry';
import { excalidrawToElements } from './io/excalidraw';
import type { Diagram } from './types';

const end = (n: { id: string }) => ({ nodeId: n.id, x: 0, y: 0 });

/** a → b → c, et a → d en parallèle (formes b, c, d en apparition auto) */
function graph(): Diagram {
  const a = createNode('rectangle', 0, 0, 100, 50, { label: 'A' });
  const [b, c, d] = ['B', 'C', 'D'].map((label, i) => createNode('rectangle', 300 * (i + 1), 0, 100, 50, { label, reveal: 'pop' }));
  const ab = createEdge(end(a), end(b), { label: 'ab' });
  const bc = createEdge(end(b), end(c), { label: 'bc' });
  const ad = createEdge(end(a), end(d), { label: 'ad' });
  return autoSequence({ ...emptyDiagram(), nodes: [a, b, c, d], edges: [ab, bc, ad] });
}
const labels = (d: Diagram, ids: string[]) => ids.map((id) => d.edges.find((e) => e.id === id)?.label ?? d.nodes.find((n) => n.id === id)?.label);

describe('ordre des étapes', () => {
  it('regroupe ce qui démarre ensemble et rattache les apparitions auto', () => {
    const d = graph();
    const steps = sequenceSteps(d);
    expect(steps.map((s) => labels(d, s.items.map((i) => i.id)))).toEqual([['ab', 'ad'], ['bc']]);
    expect(labels(d, steps[0].arrivals).sort()).toEqual(['B', 'D']);
    expect(labels(d, steps[1].arrivals)).toEqual(['C']);
  });

  it('réordonner : minutage linéaire, ordre manuel, apparitions qui suivent', () => {
    const d = graph();
    const [ab, bc, ad] = d.edges.map((e) => e.id);
    // ad passe en dernier, seul
    const r = applyStepOrder(d, [[ab], [bc], [ad]]);
    expect(r.settings.manualOrder).toBe(true);
    const delay = (id: string) => r.edges.find((e) => e.id === id)!.animation.delay;
    expect([delay(ab), delay(bc), delay(ad)]).toEqual([0, 1.8, 3.6]);
    expect(sequenceSteps(r).map((s) => labels(r, s.items.map((i) => i.id)))).toEqual([['ab'], ['bc'], ['ad']]);
    // D (auto) apparaît maintenant à l'arrivée de ad, dans la dernière étape
    expect(labels(r, sequenceSteps(r)[2].arrivals)).toEqual(['D']);
  });

  it('la pause entre animations respecte l’ordre manuel ; « Auto » revient au graphe', () => {
    const d = graph();
    const [ab, bc, ad] = d.edges.map((e) => e.id);
    const manual = applyStepOrder(d, [[ab], [bc], [ad]]);
    const slower = retime({ ...manual, settings: { ...manual.settings, stepPause: 1 } });
    expect(slower.edges.map((e) => e.animation.delay)).toEqual([0, 2.5, 5]);
    const auto = autoSequence(slower);
    expect(auto.settings.manualOrder).toBe(false);
    expect(auto.edges.find((e) => e.id === ad)!.animation.delay).toBe(0);
  });

  it('une forme glissée dans une étape prend un instant d’apparition imposé', () => {
    const d = graph();
    const c = d.nodes.find((n) => n.label === 'C')!;
    const [ab, bc, ad] = d.edges.map((e) => e.id);
    const r = applyStepOrder(d, [[ab, ad, c.id], [bc]]);
    expect(r.nodes.find((n) => n.id === c.id)!.revealDelay).toBe(0);
    expect(labels(r, sequenceSteps(r)[0].items.map((i) => i.id))).toEqual(['ab', 'ad', 'C']);
  });
});

describe('notes du présentateur', () => {
  it('rattachées au premier élément de l’étape, elles le suivent quand on réordonne', () => {
    const d = graph();
    const [ab, bc, ad] = d.edges.map((e) => e.id);
    let steps = sequenceSteps(d); // [ab, ad], [bc]
    let r = withStepNote(d, steps[0].items.map((i) => i.id), 'Le client appelle l’API et journalise.');
    r = withStepNote(r, steps[1].items.map((i) => i.id), 'Puis l’API écrit en base.');
    steps = sequenceSteps(r);
    expect(stepNote(r, steps[0])).toBe('Le client appelle l’API et journalise.');
    expect(r.edges.find((e) => e.id === ab)!.note).toBe('Le client appelle l’API et journalise.');
    // bc passe en premier : sa note le suit
    const moved = applyStepOrder(r, [[bc], [ab, ad]]);
    const s2 = sequenceSteps(moved);
    expect(stepNote(moved, s2[0])).toBe('Puis l’API écrit en base.');
    expect(stepNote(moved, s2[1])).toBe('Le client appelle l’API et journalise.');
  });

  it('fusion d’étapes : notes réunies ; réécrire les regroupe sur le premier élément', () => {
    const d = graph();
    const [ab, bc, ad] = d.edges.map((e) => e.id);
    let r = withStepNote(d, [ab, ad], 'A');
    r = withStepNote(r, [bc], 'B');
    r = applyStepOrder(r, [[ab, ad, bc]]);
    const [step] = sequenceSteps(r);
    expect(stepNote(r, step)).toBe('A\n\nB');
    r = withStepNote(r, step.items.map((i) => i.id), 'Tout ensemble');
    expect(stepNote(r, sequenceSteps(r)[0])).toBe('Tout ensemble');
    expect(r.edges.filter((e) => e.note).map((e) => e.id)).toEqual([step.items[0].id]);
    // effacer la note la retire
    r = withStepNote(r, step.items.map((i) => i.id), '   ');
    expect(r.edges.some((e) => e.note !== undefined)).toBe(false);
  });
});

describe('présentation : fin d’étape', () => {
  it('attend la fin des animations et des apparitions déclenchées, sans entamer l’étape suivante', () => {
    const d = graph(); // étapes : [ab + ad] de 0 à 1,5 s (B, D apparaissent), puis [bc] à 1,8 s
    const steps = sequenceSteps(d);
    expect(stepHoldTime(steps, -1)).toBe(0);
    // fin à 1,5 s + apparition 0,45 s, mais l'étape suivante démarre à 1,8 s : arrêt juste avant
    expect(stepHoldTime(steps, 0)).toBeCloseTo(1.78);
    // dernière étape : fin des animations + apparition de C
    expect(stepHoldTime(steps, 1)).toBeCloseTo(steps[1].end + REVEAL_DURATION + 0.05);
    // avec une pause longue, l'apparition est entièrement jouée
    const slow = retime({ ...d, settings: { ...d.settings, stepPause: 2 } });
    const s2 = sequenceSteps(slow);
    expect(stepHoldTime(s2, 0)).toBeCloseTo(s2[0].end + REVEAL_DURATION + 0.05);
    expect(stepHoldTime([], 3)).toBe(0);
  });
});

describe('inverser et raccrocher les liens', () => {
  it('inverser échange extrémités et pointes, et garde le même tracé', () => {
    const a = createNode('rectangle', 0, 0, 100, 50);
    const b = createNode('rectangle', 400, 0, 100, 50);
    const e = createEdge(end(a), end(b), { arrowHeads: 'end', routing: 'curved', curvature: 0.3 });
    const r = reverseEdge(e);
    expect(r.source.nodeId).toBe(b.id);
    expect(r.target.nodeId).toBe(a.id);
    expect(r.arrowHeads).toBe('start');
    const nodes = nodeMap([a, b]);
    const g1 = edgeGeometry(e, nodes).mid;
    const g2 = edgeGeometry(r, nodes).mid;
    expect(g2.x).toBeCloseTo(g1.x);
    expect(g2.y).toBeCloseTo(g1.y);
    expect(reverseEdge(r)).toEqual(e);
  });

  it('raccroche les extrémités proches, à la plus petite forme, pas les lointaines', () => {
    const frame = createNode('rectangle', 0, 0, 600, 400);
    const box = createNode('rectangle', 50, 50, 100, 60);
    const other = createNode('ellipse', 400, 100, 100, 60);
    const e = createEdge({ x: 155, y: 80 }, { x: 395, y: 130 });
    const r = snapEdge(e, [frame, box, other]);
    expect(r.source.nodeId).toBe(box.id); // la boîte plutôt que le grand cadre
    expect(r.target.nodeId).toBe(other.id);
    const far = snapEdge(createEdge({ x: 200, y: 300 }, { x: 900, y: 900 }), [box, other]);
    expect(far.source.nodeId).toBeUndefined();
    expect(far.target.nodeId).toBeUndefined();
  });

  it('au collage Excalidraw, les flèches non liées mais posées contre une forme sont raccrochées', () => {
    const base = { angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', strokeWidth: 2, roughness: 1, isDeleted: false };
    const r = excalidrawToElements({
      elements: [
        { ...base, id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 },
        { ...base, id: 'b', type: 'rectangle', x: 300, y: 0, width: 100, height: 60 },
        // flèche non liée, extrémités à 5 px des formes
        { ...base, id: 'arr', type: 'arrow', x: 105, y: 30, width: 190, height: 0, points: [[0, 0], [190, 0]], startBinding: null, endBinding: null, endArrowhead: 'arrow' },
        // ligne : jamais raccrochée
        { ...base, id: 'ln', type: 'line', x: 105, y: 40, width: 190, height: 0, points: [[0, 0], [190, 0]] },
      ],
    });
    expect(r.snapped).toBe(2);
    expect(r.edges[0].source.nodeId).toBe(r.nodes[0].id);
    expect(r.edges[0].target.nodeId).toBe(r.nodes[1].id);
    expect(r.edges[1].source.nodeId).toBeUndefined();
  });
});
