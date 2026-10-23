import { describe, expect, it } from 'vitest';
import { autoSequence, edgeWindow, retime } from './animation';
import { createEdge, createNode, emptyDiagram } from './defaults';
import { EXAMPLE_SEQUENCE } from './example';
import { sequenceToElements } from './io/mermaidSequence';
import type { Diagram } from './types';

const end = (n: { id: string }) => ({ nodeId: n.id, x: 0, y: 0 });

/** a → b → d et a → c → d (deux branches parallèles, jonction sur d), branche c plus lente */
function diamond(stepPause = 0.3): Diagram {
  const [a, b, c, d] = [0, 1, 2, 3].map((i) => createNode('rectangle', i * 300, 0));
  const ab = createEdge(end(a), end(b));
  const ac = createEdge(end(a), end(c));
  ac.animation = { ...ac.animation, duration: 3 };
  const bd = createEdge(end(b), end(d));
  const cd = createEdge(end(c), end(d));
  const de = createEdge(end(d), { x: 2000, y: 0 });
  const base = { ...emptyDiagram(), nodes: [a, b, c, d], edges: [ab, ac, bd, cd, de] };
  return autoSequence({ ...base, settings: { ...base.settings, stepPause } });
}
const delays = (d: Diagram) => d.edges.map((e) => e.animation.delay);

describe('pause entre les animations', () => {
  it('autoSequence utilise la pause du schéma', () => {
    // ab: 0, ac: 0, bd: 1.5+p, cd: 3+p, de: après la plus longue arrivée sur d = 3+p+1.5+p
    expect(delays(diamond(0.3))).toEqual([0, 0, 1.8, 3.3, 5.1]);
    expect(delays(diamond(1))).toEqual([0, 0, 2.5, 4, 6.5]);
  });

  it('retime donne le même minutage que si la pause avait été choisie au départ', () => {
    const d = diamond(0.3);
    expect(delays(retime({ ...d, settings: { ...d.settings, stepPause: 1 } }))).toEqual(delays(diamond(1)));
    expect(delays(retime({ ...d, settings: { ...d.settings, stepPause: 0 } }))).toEqual(delays(diamond(0)));
    // idempotent
    expect(delays(retime(d))).toEqual(delays(d));
  });

  it('une pause supplémentaire décale le flux et ceux qui le suivent', () => {
    const d = diamond(0.3);
    d.edges[2].animation.extraPause = 2; // bd
    const r = retime(d);
    expect(delays(r)[2]).toBeCloseTo(3.8);
    // de attend toujours la plus longue arrivée sur d : bd finit à 5.3 > cd à 4.8
    expect(delays(r)[4]).toBeCloseTo(5.6);
  });

  it('les notes et apparitions d’un diagramme de séquence suivent le re-minutage', () => {
    const r = sequenceToElements(EXAMPLE_SEQUENCE, { render: 'sequence', animation: 'draw', roughness: 1, reveal: true, origin: { x: 0, y: 0 }, pause: 0.3 });
    const d: Diagram = { ...emptyDiagram(), nodes: r.nodes, edges: r.edges, settings: { ...emptyDiagram().settings, ...r.settings } };
    const slow = retime({ ...d, settings: { ...d.settings, stepPause: 1.3 } });
    const msgs = slow.edges.filter((e) => e.animation.type !== 'none');
    for (let i = 1; i < msgs.length; i++) expect(msgs[i].animation.delay - msgs[i - 1].animation.delay).toBeCloseTo(0.9 + 1.3);
    const note = slow.nodes.find((n) => n.label === 'Jeton valide 15 min')!;
    expect(note.revealDelay).toBeCloseTo(msgs[3].animation.delay);
    // même résultat qu'un import direct avec cette pause
    const direct = sequenceToElements(EXAMPLE_SEQUENCE, { render: 'sequence', animation: 'draw', roughness: 1, reveal: true, origin: { x: 0, y: 0 }, pause: 1.3 });
    expect(msgs.map((e) => e.animation.delay)).toEqual(direct.edges.filter((e) => e.animation.type !== 'none').map((e) => e.animation.delay));
  });

  it('en mode boucle, la pause ajoute un temps de repos entre les répétitions', () => {
    const e = createEdge({ x: 0, y: 0 }, { x: 100, y: 0 });
    const s = emptyDiagram().settings;
    expect(edgeWindow(e, s, 0)).toMatchObject({ dur: 1.5, end: 1 });
    expect(edgeWindow(e, { ...s, loopPause: 0.5 }, 0)).toMatchObject({ dur: 2, end: 0.75 });
  });
});
