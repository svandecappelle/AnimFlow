import { describe, expect, it } from 'vitest';
import { revealTimes, sequenceCycle } from './animation';
import { emptyDiagram } from './defaults';
import { EXAMPLE_SEQUENCE } from './example';
import { edgeGeometry, nodeMap } from './geometry';
import { parseImportedText } from './io/files';
import { isSequenceDiagram, parseSequence, sequenceToElements } from './io/mermaidSequence';

const opts = { animation: 'draw' as const, roughness: 1, reveal: true, origin: { x: 0, y: 0 } };

describe('parseSequence', () => {
  it('lit participants, alias, messages, activations, notes et blocs', () => {
    const g = parseSequence(`sequenceDiagram
      autonumber
      actor U as Utilisateur
      participant S
      U->>+S: Bonjour; S-->>-U: Salut
      U-)S: async
      S->>S: réflexion
      Note right of S: pense
      loop chaque minute
        U-xS: ping
      end
      alt ok
        S-->U: oui
      else ko
        S--xU: non
      end`);
    expect(g.autonumber).toBe(true);
    expect(g.participants).toEqual([
      { id: 'U', label: 'Utilisateur', kind: 'actor' },
      { id: 'S', label: 'S', kind: 'participant' },
    ]);
    const msgs = g.events.filter((e) => e.kind === 'message');
    expect(msgs).toHaveLength(7);
    expect(msgs[0]).toMatchObject({ from: 'U', to: 'S', text: 'Bonjour', dashed: false, arrowHeads: 'end', activateTarget: true });
    expect(msgs[1]).toMatchObject({ from: 'S', to: 'U', dashed: true, deactivateSource: true });
    expect(msgs[5]).toMatchObject({ dashed: true, arrowHeads: 'none' });
    expect(g.events.filter((e) => e.kind === 'blockStart')).toHaveLength(2);
    expect(g.events.filter((e) => e.kind === 'blockEnd')).toHaveLength(2);
    expect(g.events.find((e) => e.kind === 'blockElse')).toMatchObject({ label: 'ko' });
    expect(g.events.find((e) => e.kind === 'note')).toMatchObject({ position: 'right', over: ['S'], text: 'pense' });
  });

  it('est détecté à l’import de fichier', () => {
    expect(isSequenceDiagram('%% x\nsequenceDiagram\nA->>B: hi')).toBe(true);
    expect(parseImportedText('sequenceDiagram\nA->>B: hi').kind).toBe('mermaid');
  });
});

describe('rendu séquence animée', () => {
  const r = sequenceToElements(EXAMPLE_SEQUENCE, { ...opts, render: 'sequence' });
  const d = { ...emptyDiagram(), settings: { ...emptyDiagram().settings, ...r.settings }, nodes: r.nodes, edges: r.edges };
  const messages = r.edges.filter((e) => e.animation.type !== 'none');

  it('place les messages dans l’ordre, de haut en bas, avec des délais croissants', () => {
    expect(messages).toHaveLength(11);
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].source.y).toBeGreaterThan(messages[i - 1].source.y);
      expect(messages[i].animation.delay).toBeGreaterThan(messages[i - 1].animation.delay);
    }
    expect(messages[0].label).toBe('1. Se connecter');
    expect(messages.every((m) => m.source.y === m.target.y)).toBe(true); // horizontaux
  });

  it('crée une ligne de vie par participant, des cadres pour alt/loop, une note et des activations', () => {
    const lifelines = r.edges.filter((e) => e.source.nodeId);
    expect(lifelines).toHaveLength(5);
    const frames = r.nodes.filter((n) => n.fillStyle === 'none' && n.shape === 'rectangle');
    expect(frames).toHaveLength(2);
    expect(r.nodes.some((n) => n.label === 'alt [Stock disponible]')).toBe(true);
    expect(r.edges.some((e) => e.label === '[Rupture]')).toBe(true);
    expect(r.nodes.some((n) => n.label === 'Jeton valide 15 min')).toBe(true);
    expect(r.nodes.filter((n) => n.width === 14)).toHaveLength(2);
  });

  it('les éléments apparaissent au fil de la séquence', () => {
    expect(d.settings.sequence).toBe(true);
    const t = revealTimes(d);
    expect(t.edges.get(messages[0].id)).toBe(0); // premier message : apparaît dès le démarrage (masqué à l'instant initial)
    expect(t.edges.get(messages[3].id)).toBeCloseTo(messages[3].animation.delay);
    const note = r.nodes.find((n) => n.label === 'Jeton valide 15 min')!;
    expect(t.nodes.get(note.id)).toBeCloseTo(messages[3].animation.delay);
    expect(sequenceCycle(d)).toBeGreaterThan(messages[10].animation.delay);
  });
});

describe('rendu schéma en boîtes', () => {
  const r = sequenceToElements(EXAMPLE_SEQUENCE, { ...opts, animation: 'particles', render: 'boxes' });

  it('une boîte par participant, un lien numéroté relié par message', () => {
    expect(r.nodes).toHaveLength(5);
    expect(r.edges).toHaveLength(11);
    expect(r.edges.every((e) => e.source.nodeId && e.target.nodeId)).toBe(true);
    expect(r.edges.map((e) => e.label.split('.')[0])).toEqual(r.edges.map((_, i) => String(i + 1)));
  });

  it('les messages parallèles ont des courbures différentes (pas de superposition)', () => {
    const nodes = nodeMap(r.nodes);
    const wToApi = r.edges.filter((e) => e.label.includes('Statut') || e.label.includes('POST'));
    expect(wToApi[0].curvature).not.toBe(wToApi[1].curvature);
    const mids = wToApi.map((e) => edgeGeometry(e, nodes).mid);
    expect(Math.hypot(mids[0].x - mids[1].x, mids[0].y - mids[1].y)).toBeGreaterThan(15);
  });
});
