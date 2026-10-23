import { describe, expect, it } from 'vitest';
import { REVEAL_DURATION, revealTimes, sequenceCycle } from './animation';
import { createEdge, createNode, emptyDiagram } from './defaults';
import type { Diagram } from './types';

const seq = (d: Partial<Diagram>): Diagram => ({ ...emptyDiagram(), ...d, settings: { ...emptyDiagram().settings, sequence: true, sequenceGap: 1 } });

describe('durée du cycle', () => {
  it('compte les formes à apparition imposée, même sans lien animé (régression : cycle bloqué à 1 s)', () => {
    const d = seq({
      nodes: [createNode('rectangle', 0, 0, 100, 50, { reveal: 'pop', revealDelay: 5 })],
    });
    expect(sequenceCycle(d)).toBeCloseTo(5 + REVEAL_DURATION + 1);
    expect(revealTimes(d).nodes.get(d.nodes[0].id)).toBe(5);
  });

  it('compte les liens « apparition » non animés', () => {
    const e = createEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, { reveal: true });
    e.animation = { ...e.animation, type: 'none', delay: 4 };
    expect(sequenceCycle(seq({ edges: [e] }))).toBeCloseTo(4 + REVEAL_DURATION + 1);
  });

  it('ignore les apparitions imposées de formes sans effet d’apparition, et les liens statiques', () => {
    const e = createEdge({ x: 0, y: 0 }, { x: 100, y: 0 });
    e.animation = { ...e.animation, type: 'none', delay: 9 };
    const d = seq({ nodes: [createNode('rectangle', 0, 0, 100, 50, { reveal: 'none', revealDelay: 8 })], edges: [e] });
    expect(sequenceCycle(d)).toBe(1);
  });

  it('prend le plus tardif de tous les éléments', () => {
    const e = createEdge({ x: 0, y: 0 }, { x: 100, y: 0 });
    e.animation = { ...e.animation, type: 'flow', delay: 2, duration: 1.5 };
    const late = createNode('rectangle', 0, 0, 100, 50, { reveal: 'fade', revealDelay: 7 });
    expect(sequenceCycle(seq({ edges: [e], nodes: [late] }))).toBeCloseTo(7 + REVEAL_DURATION + 1);
  });
});
