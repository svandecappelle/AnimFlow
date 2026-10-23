/**
 * Import / export d'un sous-ensemble de la syntaxe Mermaid `flowchart` / `graph`.
 *
 * Supporté : direction (TB/TD/BT/LR/RL), formes de nœuds courantes, liens `-->` `---` `-.->` `==>`
 * (avec libellés `-->|txt|` ou `-- txt -->`), chaînes `A --> B --> C`, groupes `A & B --> C`,
 * identifiants de liens `A e1@--> B` + `e1@{ animate: true }` (Mermaid ≥ 11.10).
 * Ignoré : subgraph, classDef, style, linkStyle, click…
 */
import dagre from '@dagrejs/dagre';
import { createEdge, createNode } from '../defaults';
import { measureText } from '../text';
import type { ArrowHeads, EdgeAnimationType, EdgeElement, NodeElement, NodeReveal, Point, Routing, ShapeType } from '../types';

export type Direction = 'TB' | 'BT' | 'LR' | 'RL';

export interface MermaidNode {
  id: string;
  label: string;
  shape: ShapeType;
}

export interface MermaidEdge {
  from: string;
  to: string;
  label: string;
  arrowHeads: ArrowHeads;
  style: 'solid' | 'dashed' | 'thick';
  id?: string;
  animate?: false | 'normal' | 'fast' | 'slow';
}

export interface MermaidGraph {
  direction: Direction;
  nodes: MermaidNode[];
  edges: MermaidEdge[];
}

const SHAPES: [open: string, close: string, shape: ShapeType][] = [
  ['(((', ')))', 'ellipse'],
  ['((', '))', 'ellipse'],
  ['([', '])', 'rounded'],
  ['[(', ')]', 'rounded'],
  ['[[', ']]', 'rectangle'],
  ['[/', '/]', 'rectangle'],
  ['[\\', '\\]', 'rectangle'],
  ['[/', '\\]', 'rectangle'],
  ['{{', '}}', 'rounded'],
  ['[', ']', 'rectangle'],
  ['(', ')', 'rounded'],
  ['{', '}', 'diamond'],
  ['>', ']', 'rectangle'],
];

const IGNORED = /^(subgraph|end|classDef|class|style|linkStyle|click|direction|accTitle|accDescr|title)\b/;

export function cleanLabel(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('`') && s.endsWith('`'))) s = s.slice(1, -1);
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#quot;/g, '"')
    .replace(/#35;/g, '#')
    .replace(/#59;/g, ';')
    .replace(/\\n/g, '\n');
}

/** Découpe en instructions sur les retours ligne et les `;` hors crochets/guillemets. */
export function splitStatements(src: string): string[] {
  const out: string[] = [];
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.replace(/%%.*$/, '');
    let depth = 0;
    let quote = false;
    let cur = '';
    for (const ch of line) {
      if (ch === '"') quote = !quote;
      else if (!quote && '[({'.includes(ch)) depth++;
      else if (!quote && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0 && !quote) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

const ID_RE = /[\p{L}\p{N}_]+/uy;
const EDGE_ID_RE = /\s*([\p{L}\p{N}_]+)@(?=[-=<.])/uy;
const LINK_RE = /\s*(<?)(-\.+->|-\.+-|={2,}>|={3,}|-{2,}>|-{3,})/y;
const LABELED_LINK_RE = /\s*(<?)(--|==|-\.)(?![->=.])\s*(.+?)\s*(-->|==>|\.->|---|===|\.-)/y;
const PIPE_LABEL_RE = /\s*\|([^|]*)\|/y;

export function parseMermaid(src: string): MermaidGraph {
  const statements = splitStatements(src);
  const header = statements.shift() ?? '';
  const m = /^(graph|flowchart)\b\s*(TD|TB|BT|LR|RL)?/i.exec(header);
  if (!m) throw new Error('Seuls les diagrammes Mermaid « flowchart » / « graph » sont supportés.');
  const dirRaw = (m[2] ?? 'TB').toUpperCase();
  const direction = (dirRaw === 'TD' ? 'TB' : dirRaw) as Direction;

  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  const meta = new Map<string, string>();

  const touchNode = (id: string, label?: string, shape?: ShapeType) => {
    const existing = nodes.get(id);
    if (existing) {
      if (label !== undefined) existing.label = label;
      if (shape) existing.shape = shape;
    } else {
      nodes.set(id, { id, label: label ?? id, shape: shape ?? 'rectangle' });
    }
  };

  for (const stmt of statements) {
    if (IGNORED.test(stmt)) continue;
    const metaMatch = /^([\p{L}\p{N}_]+)@\{(.*)\}$/u.exec(stmt);
    if (metaMatch) {
      meta.set(metaMatch[1], metaMatch[2]);
      continue;
    }

    let pos = 0;
    const skipWs = () => {
      while (pos < stmt.length && /\s/.test(stmt[pos])) pos++;
    };
    const sticky = (re: RegExp) => {
      re.lastIndex = pos;
      const r = re.exec(stmt);
      if (r) pos = re.lastIndex;
      return r;
    };
    const parseNode = (): string | null => {
      skipWs();
      const idm = sticky(ID_RE);
      if (!idm) return null;
      const id = idm[0];
      for (const [open, close, shape] of SHAPES) {
        if (stmt.startsWith(open, pos)) {
          const end = stmt.indexOf(close, pos + open.length);
          if (end < 0) continue;
          touchNode(id, cleanLabel(stmt.slice(pos + open.length, end)), shape);
          pos = end + close.length;
          sticky(/:::[\w-]+/y);
          return id;
        }
      }
      sticky(/:::[\w-]+/y);
      touchNode(id);
      return id;
    };
    const parseGroup = (): string[] => {
      const ids: string[] = [];
      const first = parseNode();
      if (!first) return ids;
      ids.push(first);
      while (sticky(/\s*&/y)) {
        const next = parseNode();
        if (next) ids.push(next);
      }
      return ids;
    };

    let left = parseGroup();
    if (!left.length) continue;
    for (;;) {
      const edgeId = sticky(EDGE_ID_RE)?.[1];
      let op: string;
      let startArrow: boolean;
      let label = '';
      const plain = sticky(LINK_RE);
      if (plain) {
        startArrow = plain[1] === '<';
        op = plain[2];
      } else {
        const labeled = sticky(LABELED_LINK_RE);
        if (!labeled) break;
        startArrow = labeled[1] === '<';
        label = cleanLabel(labeled[3]);
        op = labeled[2] + labeled[4];
      }
      const pipe = sticky(PIPE_LABEL_RE);
      if (pipe) label = cleanLabel(pipe[1]);
      const right = parseGroup();
      if (!right.length) break;
      const endArrow = op.endsWith('>');
      const arrowHeads: ArrowHeads = startArrow && endArrow ? 'both' : endArrow ? 'end' : startArrow ? 'start' : 'none';
      const style = op.includes('.') ? 'dashed' : op.includes('=') ? 'thick' : 'solid';
      for (const from of left) for (const to of right) edges.push({ from, to, label, arrowHeads, style, id: edgeId });
      left = right;
    }
  }

  // Métadonnées `id@{ ... }` : animation des liens, forme/libellé des nœuds
  for (const [id, body] of meta) {
    const get = (k: string) => new RegExp(`${k}\\s*:\\s*("([^"]*)"|[\\w-]+)`).exec(body);
    const edge = edges.find((e) => e.id === id);
    if (edge) {
      const anim = get('animation')?.[1];
      const animate = get('animate')?.[1];
      if (anim === 'fast' || anim === 'slow') edge.animate = anim;
      else if (animate === 'true') edge.animate = 'normal';
      else if (animate === 'false') edge.animate = false;
      continue;
    }
    const shapeRaw = get('shape')?.[1];
    const labelRaw = get('label');
    const shapeMap: Record<string, ShapeType> = {
      circle: 'ellipse',
      circ: 'ellipse',
      'sm-circ': 'ellipse',
      diamond: 'diamond',
      decision: 'diamond',
      diam: 'diamond',
      rounded: 'rounded',
      stadium: 'rounded',
      rect: 'rectangle',
    };
    touchNode(id, labelRaw ? cleanLabel(labelRaw[2] ?? labelRaw[1]) : undefined, shapeRaw ? shapeMap[shapeRaw] : undefined);
  }

  return { direction, nodes: [...nodes.values()], edges };
}

export interface MermaidImportOptions {
  animation: EdgeAnimationType;
  roughness: number;
  routing: Routing;
  reveal?: NodeReveal;
  /** Coin haut-gauche où placer le graphe */
  origin: Point;
}

/** Convertit du Mermaid en éléments positionnés (mise en page automatique dagre). */
export function mermaidToElements(src: string, opts: MermaidImportOptions): { nodes: NodeElement[]; edges: EdgeElement[] } {
  const graph = parseMermaid(src);
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: graph.direction, nodesep: 60, ranksep: 90, edgesep: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, [number, number]>();
  for (const n of graph.nodes) {
    const t = measureText(n.label, 'hand', 20);
    let w = Math.max(120, t.width + 48);
    let h = Math.max(64, t.height + 32);
    if (n.shape === 'diamond') {
      w *= 1.45;
      h *= 1.5;
    } else if (n.shape === 'ellipse') {
      w *= 1.2;
      h *= 1.25;
    }
    sizes.set(n.id, [Math.round(w), Math.round(h)]);
    g.setNode(n.id, { width: w, height: h });
  }
  graph.edges.forEach((e, i) => {
    const lt = e.label ? measureText(e.label, 'hand', 16) : { width: 0, height: 0 };
    g.setEdge(e.from, e.to, { width: lt.width, height: lt.height, labelpos: 'c' }, `e${i}`);
  });
  dagre.layout(g);

  const palette: Record<ShapeType, string> = {
    rectangle: '#a5d8ff',
    rounded: '#b2f2bb',
    ellipse: '#ffec99',
    diamond: '#eebefa',
    text: 'transparent',
  };
  const idMap = new Map<string, string>();
  const nodes = graph.nodes.map((n) => {
    const pos = g.node(n.id);
    const [w, h] = sizes.get(n.id)!;
    const node = createNode(n.shape, Math.round(opts.origin.x + pos.x - w / 2), Math.round(opts.origin.y + pos.y - h / 2), w, h, {
      label: n.label,
      fillColor: palette[n.shape],
      roughness: opts.roughness,
      fontFamily: opts.roughness === 0 ? 'sans' : 'hand',
      fontSize: opts.roughness === 0 ? 16 : 20,
      fillStyle: opts.roughness === 0 ? 'solid' : 'hachure',
      reveal: opts.reveal ?? 'none',
    });
    idMap.set(n.id, node.id);
    return node;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const end = (mid: string) => {
    const id = idMap.get(mid)!;
    const n = byId.get(id)!;
    return { nodeId: id, x: n.x + n.width / 2, y: n.y + n.height / 2 };
  };
  const edges = graph.edges.map((e) => {
    const base = createEdge(end(e.from), end(e.to), {
      label: e.label,
      arrowHeads: e.arrowHeads,
      strokeStyle: e.style === 'dashed' ? 'dashed' : 'solid',
      strokeWidth: e.style === 'thick' ? 3.5 : 2,
      roughness: opts.roughness,
      routing: opts.routing,
      fontFamily: opts.roughness === 0 ? 'sans' : 'hand',
      fontSize: opts.roughness === 0 ? 13 : 16,
    });
    const type: EdgeAnimationType =
      e.animate === false ? 'none' : e.animate ? (opts.animation === 'none' ? 'flow' : opts.animation) : opts.animation;
    const duration = e.animate === 'fast' ? 0.8 : e.animate === 'slow' ? 2.5 : base.animation.duration;
    return { ...base, animation: { ...base.animation, type, duration } };
  });
  return { nodes, edges };
}

const escapeLabel = (s: string) => s.replace(/"/g, '#quot;').replace(/\n/g, '<br>');

/** Export Mermaid : seuls les liens reliant deux nœuds sont exportés. */
export function diagramToMermaid(nodes: NodeElement[], edges: EdgeElement[]): string {
  let dir = 'TD';
  if (nodes.length > 1) {
    const xs = nodes.map((n) => n.x + n.width / 2);
    const ys = nodes.map((n) => n.y + n.height / 2);
    if (Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys)) dir = 'LR';
  }
  const ids = new Map(nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const lines = [`flowchart ${dir}`];
  for (const n of nodes) {
    const label = escapeLabel(n.label || ' ');
    const id = ids.get(n.id)!;
    const shape =
      n.shape === 'ellipse'
        ? `((\"${label}\"))`
        : n.shape === 'diamond'
          ? `{\"${label}\"}`
          : n.shape === 'rounded'
            ? `(\"${label}\")`
            : `[\"${label}\"]`;
    lines.push(`    ${id}${shape}`);
  }
  const anims: string[] = [];
  edges.forEach((e, i) => {
    const from = e.source.nodeId && ids.get(e.source.nodeId);
    const to = e.target.nodeId && ids.get(e.target.nodeId);
    if (!from || !to) return;
    const dashed = e.strokeStyle !== 'solid';
    const thick = e.strokeWidth >= 3;
    const end = e.arrowHeads === 'end' || e.arrowHeads === 'both';
    const start = e.arrowHeads === 'start' || e.arrowHeads === 'both';
    let op = dashed ? (end ? '-.->' : '-.-') : thick ? (end ? '==>' : '===') : end ? '-->' : '---';
    if (start) op = `<${op}`;
    const label = e.label ? `|${escapeLabel(e.label).replace(/\|/g, '/')}|` : '';
    const animated = e.animation.type !== 'none';
    const eid = animated ? `e${i + 1}@` : '';
    lines.push(`    ${from} ${eid}${op}${label} ${to}`);
    if (animated) {
      const speed = e.animation.duration <= 1 ? 'fast' : e.animation.duration >= 2.2 ? 'slow' : null;
      anims.push(`    e${i + 1}@{ ${speed ? `animation: ${speed}` : 'animate: true'} }`);
    }
  });
  return [...lines, ...anims].join('\n');
}
