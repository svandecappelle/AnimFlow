/**
 * Import des diagrammes de séquence Mermaid (`sequenceDiagram`), avec deux rendus :
 *  - « sequence » : diagramme de séquence classique (participants, lignes de vie, messages horizontaux, notes,
 *    blocs loop/alt/opt/par, activations), animé message par message ;
 *  - « boxes » : schéma en boîtes lisible, un participant = une boîte, un message = un lien numéroté,
 *    les flux s'enchaînant dans l'ordre chronologique.
 *
 * Supporté : participant / actor (alias `as`), messages `->` `-->` `->>` `-->>` `-x` `--x` `-)` `--)` `<<->>`,
 * activations (`+` / `-`, activate / deactivate), Note left of / right of / over, loop / alt / else / opt / par /
 * and / critical / option / break / rect / box … end, autonumber, title.
 */
import dagre from '@dagrejs/dagre';
import { createEdge, createNode } from '../defaults';
import { edgeGeometry, nodeMap } from '../geometry';
import { measureText } from '../text';
import type { ArrowHeads, DiagramSettings, EdgeAnimationType, EdgeElement, NodeElement, Point } from '../types';
import { cleanLabel, splitStatements } from './mermaid';

export interface SeqParticipant {
  id: string;
  label: string;
  kind: 'participant' | 'actor';
}

export type SeqEvent =
  | {
      kind: 'message';
      from: string;
      to: string;
      text: string;
      dashed: boolean;
      arrowHeads: ArrowHeads;
      activateTarget: boolean;
      deactivateSource: boolean;
    }
  | { kind: 'note'; position: 'left' | 'right' | 'over'; over: string[]; text: string }
  | { kind: 'blockStart'; type: string; label: string }
  | { kind: 'blockElse'; type: string; label: string }
  | { kind: 'blockEnd' }
  | { kind: 'activate' | 'deactivate'; id: string };

export interface SequenceGraph {
  title?: string;
  autonumber: boolean;
  participants: SeqParticipant[];
  events: SeqEvent[];
}

const NAME = '[\\p{L}\\p{N}_.]+';
const ARROW = '(<<-->>|<<->>|-->>|->>|--x|-x|--\\)|-\\)|-->|->)';
const MESSAGE_RE = new RegExp(`^(${NAME})\\s*${ARROW}\\s*([+-]?)\\s*(${NAME})\\s*(?::(.*))?$`, 'u');
const PARTICIPANT_RE = /^(?:create\s+)?(participant|actor)\s+("[^"]+"|[^\s@]+)(?:@\{[^}]*\})?(?:\s+as\s+(.+))?$/i;
const NOTE_RE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:(.*)$/i;
const BLOCK_START_RE = /^(loop|alt|opt|par|critical|break|rect|box)\b\s*(.*)$/i;
const BLOCK_ELSE_RE = /^(else|and|option)\b\s*(.*)$/i;

export const isSequenceDiagram = (src: string) => /^sequenceDiagram\b/.test(splitStatements(src)[0] ?? '');

export function parseSequence(src: string): SequenceGraph {
  const statements = splitStatements(src);
  if (!/^sequenceDiagram\b/.test(statements.shift() ?? '')) throw new Error('Ce n’est pas un diagramme de séquence Mermaid.');
  const g: SequenceGraph = { autonumber: false, participants: [], events: [] };
  const known = new Map<string, SeqParticipant>();
  const ensure = (id: string) => {
    if (!known.has(id)) {
      const p: SeqParticipant = { id, label: id, kind: 'participant' };
      known.set(id, p);
      g.participants.push(p);
    }
    return id;
  };
  const blockTypes: string[] = [];

  for (const stmt of statements) {
    let m: RegExpExecArray | null;
    if ((m = PARTICIPANT_RE.exec(stmt))) {
      const id = m[2].replace(/^"|"$/g, '');
      ensure(id);
      const p = known.get(id)!;
      p.kind = m[1].toLowerCase() === 'actor' ? 'actor' : 'participant';
      if (m[3]) p.label = cleanLabel(m[3]);
    } else if ((m = MESSAGE_RE.exec(stmt))) {
      const op = m[2];
      const head = op.endsWith('>>') || op.endsWith('x') || op.endsWith(')');
      g.events.push({
        kind: 'message',
        from: ensure(m[1]),
        to: ensure(m[4]),
        text: cleanLabel(m[5] ?? ''),
        dashed: op.replace(/^<</, '').startsWith('--'),
        arrowHeads: op.startsWith('<<') ? 'both' : head ? 'end' : 'none',
        activateTarget: m[3] === '+',
        deactivateSource: m[3] === '-',
      });
    } else if ((m = NOTE_RE.exec(stmt))) {
      const pos = m[1].toLowerCase();
      g.events.push({
        kind: 'note',
        position: pos === 'over' ? 'over' : pos.startsWith('left') ? 'left' : 'right',
        over: m[2].split(',').map((s) => ensure(s.trim())),
        text: cleanLabel(m[3]),
      });
    } else if ((m = BLOCK_START_RE.exec(stmt))) {
      blockTypes.push(m[1].toLowerCase());
      g.events.push({ kind: 'blockStart', type: m[1].toLowerCase(), label: cleanLabel(m[2]) });
    } else if ((m = BLOCK_ELSE_RE.exec(stmt))) {
      g.events.push({ kind: 'blockElse', type: m[1].toLowerCase(), label: cleanLabel(m[2]) });
    } else if (/^end$/i.test(stmt)) {
      if (blockTypes.pop()) g.events.push({ kind: 'blockEnd' });
    } else if ((m = /^(activate|deactivate)\s+(\S+)$/i.exec(stmt))) {
      g.events.push({ kind: m[1].toLowerCase() as 'activate' | 'deactivate', id: ensure(m[2]) });
    } else if (/^autonumber\b/i.test(stmt)) {
      g.autonumber = true;
    } else if ((m = /^title\s*:?\s*(.+)$/i.exec(stmt))) {
      g.title = cleanLabel(m[1]);
    }
    // autres instructions (links, properties, destroy, accTitle…) ignorées
  }
  while (blockTypes.pop()) g.events.push({ kind: 'blockEnd' });
  return g;
}

export interface SequenceImportOptions {
  render: 'sequence' | 'boxes';
  animation: EdgeAnimationType;
  roughness: number;
  /** Apparition progressive (messages/notes/blocs en séquence, boîtes en schéma) */
  reveal: boolean;
  origin: Point;
  /** Durée d'animation d'un message (s) */
  messageDuration?: number;
  /** Pause entre deux messages (s) */
  pause?: number;
}

export interface ImportedElements {
  nodes: NodeElement[];
  edges: EdgeElement[];
  settings: Partial<DiagramSettings>;
}

const FILLS = ['#a5d8ff', '#b2f2bb', '#ffec99', '#eebefa', '#ffc9c9', '#99e9f2'];
const STROKES = ['#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#e03131', '#0c8599'];
/** Pause entre deux messages par défaut (s) */
const DEFAULT_PAUSE = 0.3;

export function sequenceToElements(src: string, opts: SequenceImportOptions): ImportedElements {
  const g = parseSequence(src);
  if (!g.participants.length) throw new Error('Aucun participant trouvé.');
  return opts.render === 'boxes' ? layoutBoxes(g, opts) : layoutSequence(g, opts);
}

function style(opts: SequenceImportOptions) {
  const clean = opts.roughness === 0;
  return {
    font: clean ? ('sans' as const) : ('hand' as const),
    size: clean ? 15 : 18,
    fillStyle: clean ? ('solid' as const) : ('hachure' as const),
  };
}

function layoutSequence(g: SequenceGraph, opts: SequenceImportOptions): ImportedElements {
  const st = style(opts);
  const dur = opts.messageDuration ?? 0.9;
  const pause = opts.pause ?? DEFAULT_PAUSE;
  const step = dur + pause;
  const idx = new Map(g.participants.map((p, i) => [p.id, i]));
  const pw = g.participants.map((p) => Math.max(110, measureText(p.label, st.font, st.size).width + 40));
  const boxH = 60;

  // Espacement des colonnes : assez large pour les participants, les libellés de messages et les notes latérales
  let gap = Math.max(200, ...pw.map((w) => w + 50));
  for (const ev of g.events) {
    if (ev.kind === 'message' && ev.from !== ev.to) {
      const span = Math.abs(idx.get(ev.from)! - idx.get(ev.to)!);
      // libellé + numéro + place pour voir le trait et la flèche de part et d'autre
      gap = Math.max(gap, (measureText(`00. ${ev.text}`, st.font, st.size - 3).width + 110) / span);
    } else if (ev.kind === 'note' && ev.position !== 'over') {
      gap = Math.max(gap, measureText(ev.text, st.font, st.size - 2).width + 80);
    }
  }
  gap = Math.round(gap);
  const colX = (id: string) => opts.origin.x + pw[0] / 2 + idx.get(id)! * gap;

  const frames: NodeElement[] = [];
  const bars: NodeElement[] = [];
  const front: NodeElement[] = [];
  const dividers: EdgeElement[] = [];
  const messages: EdgeElement[] = [];

  let y0 = opts.origin.y;
  if (g.title) {
    const m = measureText(g.title, st.font, st.size + 6);
    front.push(createNode('text', opts.origin.x, y0, m.width + 16, m.height + 8, { label: g.title, fontFamily: st.font, fontSize: st.size + 6 }));
    y0 += m.height + 30;
  }
  const participants = g.participants.map((p, i) =>
    createNode(p.kind === 'actor' ? 'ellipse' : 'rounded', Math.round(colX(p.id) - pw[i] / 2), y0, Math.round(pw[i]), boxH, {
      label: p.label,
      fillColor: FILLS[i % FILLS.length],
      fillStyle: st.fillStyle,
      roughness: opts.roughness,
      fontFamily: st.font,
      fontSize: st.size,
      sticky: true,
    }),
  );

  let y = y0 + boxH + 50;
  let msgIndex = 0;
  let num = 0;
  let lastMsgY = y;
  const time = () => Math.round(msgIndex * step * 100) / 100;
  const reveal = opts.reveal ? ('fade' as const) : ('none' as const);
  const open: { type: string; label: string; top: number; t: number; cols: Set<number>; elses: { y: number; label: string; t: number }[] }[] = [];
  const touch = (...ids: string[]) => open.forEach((f) => ids.forEach((id) => f.cols.add(idx.get(id)!)));
  const active = new Map<string, { y: number; t: number }[]>();
  const depth = (id: string) => active.get(id)?.length ?? 0;
  const startBar = (id: string, at: number) => active.set(id, [...(active.get(id) ?? []), { y: at, t: time() }]);
  const endBar = (id: string, at: number) => {
    const stack = active.get(id);
    const bar = stack?.pop();
    if (!bar) return;
    const d = stack!.length;
    bars.push(
      createNode('rectangle', colX(id) - 7 + d * 5, bar.y - 6, 14, Math.max(18, at - bar.y + 12), {
        fillColor: '#ffffff',
        fillStyle: 'solid',
        strokeColor: '#495057',
        strokeWidth: 1.5,
        roughness: opts.roughness,
        reveal,
        revealDelay: opts.reveal ? bar.t : null,
      }),
    );
  };

  for (const ev of g.events) {
    switch (ev.kind) {
      case 'message': {
        const label = (g.autonumber ? `${++num}. ` : '') + ev.text;
        const common = {
          label,
          strokeStyle: ev.dashed ? ('dashed' as const) : ('solid' as const),
          arrowHeads: ev.arrowHeads,
          strokeColor: STROKES[idx.get(ev.from)! % STROKES.length],
          roughness: opts.roughness,
          fontFamily: st.font,
          fontSize: st.size - 3,
          reveal: opts.reveal,
        };
        const x1 = colX(ev.from);
        let edge: EdgeElement;
        if (ev.from === ev.to) {
          const x = x1 + (depth(ev.from) ? 7 : 0);
          edge = createEdge({ x, y }, { x, y: y + 30 }, { ...common, routing: 'curved', curvature: -1.6 });
          y += 30;
        } else {
          const dir = Math.sign(colX(ev.to) - x1);
          const sx = x1 + dir * (depth(ev.from) ? 7 : 0);
          const tx = colX(ev.to) - dir * (depth(ev.to) || ev.activateTarget ? 7 : 0);
          edge = createEdge({ x: sx, y }, { x: tx, y }, { ...common, routing: 'straight' });
        }
        edge.animation = { ...edge.animation, type: opts.animation, duration: dur, delay: time() };
        messages.push(edge);
        if (ev.activateTarget) startBar(ev.to, y);
        if (ev.deactivateSource) endBar(ev.from, y);
        touch(ev.from, ev.to);
        lastMsgY = y;
        y += 52;
        msgIndex++;
        break;
      }
      case 'note': {
        const m = measureText(ev.text, st.font, st.size - 2);
        let w = Math.max(120, m.width + 28);
        const h = m.height + 20;
        const xs = ev.over.map(colX);
        let x: number;
        if (ev.position === 'over') {
          if (xs.length > 1) w = Math.max(w, Math.max(...xs) - Math.min(...xs) + 100);
          x = (Math.min(...xs) + Math.max(...xs)) / 2 - w / 2;
        } else if (ev.position === 'right') x = xs[0] + 14;
        else x = xs[0] - 14 - w;
        front.push(
          createNode('rectangle', Math.round(x), y - 10, Math.round(w), h, {
            label: ev.text,
            fillColor: '#fff3bf',
            fillStyle: 'solid',
            strokeColor: '#e67700',
            strokeWidth: 1.5,
            roughness: opts.roughness,
            fontFamily: st.font,
            fontSize: st.size - 2,
            reveal,
            revealDelay: opts.reveal ? time() : null,
          }),
        );
        touch(...ev.over);
        y += h + 24;
        break;
      }
      case 'blockStart':
        open.push({ type: ev.type, label: ev.label, top: y - 18, t: time(), cols: new Set(), elses: [] });
        y += 36;
        break;
      case 'blockElse': {
        const f = open[open.length - 1];
        if (f) f.elses.push({ y: y - 8, label: ev.label, t: time() });
        y += 36;
        break;
      }
      case 'blockEnd': {
        const f = open.pop();
        if (!f) break;
        f.cols.forEach((c) => open.forEach((parent) => parent.cols.add(c)));
        if (f.type === 'rect' || f.type === 'box') break;
        const cols = f.cols.size ? [...f.cols] : g.participants.map((_, i) => i);
        const pad = Math.max(30, 80 - open.length * 14);
        const x1 = colX(g.participants[Math.min(...cols)].id) - pad;
        const x2 = colX(g.participants[Math.max(...cols)].id) + pad;
        const y2 = y - 6;
        const frameReveal = { reveal, revealDelay: opts.reveal ? f.t : null };
        frames.push(
          createNode('rectangle', x1, f.top, x2 - x1, y2 - f.top, {
            fillColor: 'transparent',
            fillStyle: 'none',
            strokeColor: '#868e96',
            strokeWidth: 1.5,
            roughness: opts.roughness,
            ...frameReveal,
          }),
        );
        const title = f.label ? `${f.type} [${f.label}]` : f.type;
        const tm = measureText(title, st.font, st.size - 4);
        front.push(
          createNode('text', x1 + 6, f.top + 4, tm.width + 12, tm.height + 6, {
            label: title,
            fontFamily: st.font,
            fontSize: st.size - 4,
            textColor: '#495057',
            ...frameReveal,
          }),
        );
        for (const e of f.elses) {
          const div = createEdge({ x: x1, y: e.y }, { x: x2, y: e.y }, {
            label: e.label ? `[${e.label}]` : '',
            strokeStyle: 'dashed',
            strokeColor: '#868e96',
            strokeWidth: 1.5,
            arrowHeads: 'none',
            roughness: opts.roughness,
            fontFamily: st.font,
            fontSize: st.size - 4,
            reveal: opts.reveal,
          });
          div.animation = { ...div.animation, type: 'none', delay: e.t };
          dividers.push(div);
        }
        y += 22;
        break;
      }
      case 'activate':
        startBar(ev.id, lastMsgY);
        break;
      case 'deactivate':
        endBar(ev.id, lastMsgY);
        break;
    }
  }
  for (const id of active.keys()) while (depth(id)) endBar(id, y - 30);

  const yEnd = y + 10;
  const lifelines = participants.map((n) => {
    const x = n.x + n.width / 2;
    const e = createEdge({ nodeId: n.id, x, y: n.y + n.height }, { x, y: yEnd }, {
      strokeStyle: 'dashed',
      strokeColor: '#adb5bd',
      strokeWidth: 1.5,
      arrowHeads: 'none',
      roughness: 0,
      repeatLabel: true,
    });
    e.animation = { ...e.animation, type: 'none' };
    return e;
  });

  return {
    nodes: [...frames, ...bars, ...participants, ...front],
    edges: [...lifelines, ...dividers, ...messages],
    settings: { sequence: true, sequenceGap: 1.5, stepPause: pause },
  };
}

function layoutBoxes(g: SequenceGraph, opts: SequenceImportOptions): ImportedElements {
  const st = style(opts);
  const dur = opts.messageDuration ?? 1.2;
  const pause = opts.pause ?? DEFAULT_PAUSE;
  const step = dur + pause;
  const messages = g.events.filter((e): e is Extract<SeqEvent, { kind: 'message' }> => e.kind === 'message');

  // Dagre ne sert qu'à placer les boîtes : une seule arête par paire de participants (plus stable que le multigraphe)
  const graph = new dagre.graphlib.Graph();
  // Espacement adapté aux libellés : les messages courbés doivent avoir la place de s'écarter
  const longest = Math.max(0, ...messages.map((m, i) => measureText(`${i + 1}. ${m.text}`, st.font, st.size - 3).width));
  graph.setGraph({ rankdir: 'LR', nodesep: 160, ranksep: Math.max(240, longest + 120) });
  graph.setDefaultEdgeLabel(() => ({}));
  const sizes = new Map<string, [number, number]>();
  for (const p of g.participants) {
    const m = measureText(p.label, st.font, st.size + 2);
    const w = Math.round(Math.max(130, m.width + 48) * (p.kind === 'actor' ? 1.2 : 1));
    const h = Math.round(Math.max(70, m.height + 36));
    sizes.set(p.id, [w, h]);
    graph.setNode(p.id, { width: w, height: h });
  }
  for (const m of messages) {
    if (m.from !== m.to && !graph.hasEdge(m.from, m.to) && !graph.hasEdge(m.to, m.from)) graph.setEdge(m.from, m.to, {});
  }
  dagre.layout(graph);

  const nodeIds = new Map<string, string>();
  const nodes = g.participants.map((p, i) => {
    const pos = graph.node(p.id);
    const [w, h] = sizes.get(p.id)!;
    const n = createNode(p.kind === 'actor' ? 'ellipse' : 'rounded', Math.round(opts.origin.x + pos.x - w / 2), Math.round(opts.origin.y + pos.y - h / 2), w, h, {
      label: p.label,
      fillColor: FILLS[i % FILLS.length],
      fillStyle: st.fillStyle,
      roughness: opts.roughness,
      fontFamily: st.font,
      fontSize: st.size + 2,
      reveal: opts.reveal ? 'pop' : 'none',
    });
    nodeIds.set(p.id, n.id);
    return n;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const end = (pid: string) => {
    const n = byId.get(nodeIds.get(pid)!)!;
    return { nodeId: n.id, x: n.x + n.width / 2, y: n.y + n.height / 2 };
  };

  // Messages entre deux mêmes participants : courbures croissantes pour qu'ils ne se superposent pas
  const pairTotal = new Map<string, number>();
  const pairKey = (a: string, b: string) => [a, b].sort().join('\u0000');
  for (const m of messages) pairTotal.set(pairKey(m.from, m.to), (pairTotal.get(pairKey(m.from, m.to)) ?? 0) + 1);
  const dirCount = new Map<string, number>();

  const edges = messages.map((m, i) => {
    const pk = pairKey(m.from, m.to);
    const dk = `${m.from}\u0000${m.to}`;
    const j = dirCount.get(dk) ?? 0;
    dirCount.set(dk, j + 1);
    const curvature = m.from === m.to ? j * 0.5 : pairTotal.get(pk)! > 1 ? 0.15 + 0.17 * j : 0;
    const e = createEdge(end(m.from), end(m.to), {
      label: `${i + 1}. ${m.text}`,
      strokeStyle: m.dashed ? 'dashed' : 'solid',
      arrowHeads: m.arrowHeads === 'none' ? 'end' : m.arrowHeads,
      strokeColor: STROKES[g.participants.findIndex((p) => p.id === m.from) % STROKES.length],
      roughness: opts.roughness,
      routing: 'curved',
      curvature,
      fontFamily: st.font,
      fontSize: st.size - 3,
    });
    e.animation = { ...e.animation, type: opts.animation, duration: dur, delay: Math.round(i * step * 100) / 100 };
    return e;
  });

  separateLabels(nodes, edges);
  return { nodes, edges, settings: { sequence: true, sequenceGap: 1.5, stepPause: pause } };
}

/** Écarte les libellés qui se chevauchent en accentuant la courbure du lien concerné. */
function separateLabels(nodes: NodeElement[], edges: EdgeElement[]) {
  const map = nodeMap(nodes);
  const box = (e: EdgeElement) => {
    const g = edgeGeometry(e, map);
    const m = measureText(e.label, e.fontFamily, e.fontSize);
    return { x: g.mid.x - m.width / 2 - 6, y: g.mid.y - m.height / 2 - 3, w: m.width + 12, h: m.height + 6 };
  };
  const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    const boxes = edges.map(box);
    for (let i = 1; i < edges.length; i++) {
      if (edges[i].source.nodeId === edges[i].target.nodeId) continue;
      if (boxes.slice(0, i).some((b) => overlap(b, boxes[i]))) {
        edges[i].curvature = (edges[i].curvature ?? 0) + 0.15;
        boxes[i] = box(edges[i]);
        moved = true;
      }
    }
    if (!moved) break;
  }
}
