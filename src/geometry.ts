import type { Diagram, EdgeElement, EdgeEnd, NodeElement, Point } from './types';

/** Espace laissé entre l'extrémité d'un lien et le bord du nœud */
export const EDGE_GAP = 6;

export type NodeMap = Map<string, NodeElement>;

export const nodeMap = (nodes: NodeElement[]): NodeMap => new Map(nodes.map((n) => [n.id, n]));

export const center = (n: NodeElement): Point => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

const unit = (from: Point, to: Point): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
};

/** Point du contour du nœud dans la direction de `toward`, éloigné de `gap` pixels. */
export function boundaryPoint(n: NodeElement, toward: Point, gap = 0): Point {
  const c = center(n);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return c;
  const hw = n.width / 2;
  const hh = n.height / 2;
  let t: number;
  switch (n.shape) {
    case 'ellipse':
      t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
      break;
    case 'diamond':
      t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
      break;
    default:
      t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  }
  const g = gap / dist;
  return { x: c.x + dx * (t + g), y: c.y + dy * (t + g) };
}

export function resolveEnd(end: EdgeEnd, nodes: NodeMap): { node?: NodeElement; p: Point } {
  const node = end.nodeId ? nodes.get(end.nodeId) : undefined;
  return { node, p: node ? center(node) : { x: end.x, y: end.y } };
}

export interface EdgeGeometry {
  /** Chemin SVG dans le sens source → cible */
  d: string;
  /** Chemin SVG dans le sens cible → source */
  dRev: string;
  /** Polyligne échantillonnée (rendu rough, longueur, hit-test) */
  points: Point[];
  length: number;
  start: Point;
  end: Point;
  /** Direction (unitaire) d'une flèche dessinée au départ / à l'arrivée */
  startDir: Point;
  endDir: Point;
  mid: Point;
}

const fmt = (n: number) => Math.round(n * 100) / 100;
const pathFromPoints = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');

export function polylineLength(pts: Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

export function pointAtLength(pts: Point[], target: number): Point {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + seg >= target && seg > 0) {
      const t = (target - acc) / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}

function finish(points: Point[], d: string, dRev: string): EdgeGeometry {
  const n = points.length;
  const length = polylineLength(points);
  return {
    d,
    dRev,
    points,
    length,
    start: points[0],
    end: points[n - 1],
    startDir: unit(points[1] ?? points[0], points[0]),
    endDir: unit(points[n - 2] ?? points[n - 1], points[n - 1]),
    mid: pointAtLength(points, length / 2),
  };
}

/** Lien d'un nœud vers lui-même : boucle au-dessus du coin haut-droit. */
function selfLoop(n: NodeElement, curvature: number): EdgeGeometry {
  const size = Math.max(40, n.height * 0.6) * (1 + Math.abs(curvature));
  const start = { x: n.x + n.width * 0.75, y: n.y - EDGE_GAP };
  const end = { x: n.x + n.width + EDGE_GAP, y: n.y + n.height * 0.25 };
  const c1 = { x: start.x, y: start.y - size };
  const c2 = { x: end.x + size, y: end.y };
  const pts: Point[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const a = (1 - u) ** 3;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u * u;
    const e = u ** 3;
    pts.push({ x: a * start.x + b * c1.x + c * c2.x + e * end.x, y: a * start.y + b * c1.y + c * c2.y + e * end.y });
  }
  const cubic = (p0: Point, k1: Point, k2: Point, p1: Point) =>
    `M${fmt(p0.x)} ${fmt(p0.y)} C${fmt(k1.x)} ${fmt(k1.y)} ${fmt(k2.x)} ${fmt(k2.y)} ${fmt(p1.x)} ${fmt(p1.y)}`;
  return finish(pts, cubic(start, c1, c2, end), cubic(end, c2, c1, start));
}

export function edgeGeometry(edge: EdgeElement, nodes: NodeMap): EdgeGeometry {
  const s = resolveEnd(edge.source, nodes);
  const t = resolveEnd(edge.target, nodes);
  const sc = s.p;
  const tc = t.p;

  if (s.node && s.node === t.node) return selfLoop(s.node, edge.curvature ?? 0.25);

  if (edge.routing === 'elbow') {
    const dx = tc.x - sc.x;
    const dy = tc.y - sc.y;
    let pts: Point[];
    if (Math.abs(dx) >= Math.abs(dy)) {
      const sx = Math.sign(dx) || 1;
      const start = { x: sc.x + sx * (s.node ? s.node.width / 2 + EDGE_GAP : 0), y: sc.y };
      const end = { x: tc.x - sx * (t.node ? t.node.width / 2 + EDGE_GAP : 0), y: tc.y };
      const mx = (start.x + end.x) / 2;
      pts = [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end];
    } else {
      const sy = Math.sign(dy) || 1;
      const start = { x: sc.x, y: sc.y + sy * (s.node ? s.node.height / 2 + EDGE_GAP : 0) };
      const end = { x: tc.x, y: tc.y - sy * (t.node ? t.node.height / 2 + EDGE_GAP : 0) };
      const my = (start.y + end.y) / 2;
      pts = [start, { x: start.x, y: my }, { x: end.x, y: my }, end];
    }
    pts = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.5);
    if (pts.length < 2) pts = [pts[0], pts[0]];
    return finish(pts, pathFromPoints(pts), pathFromPoints([...pts].reverse()));
  }

  if (edge.routing === 'curved') {
    const dx = tc.x - sc.x;
    const dy = tc.y - sc.y;
    const k = edge.curvature ?? 0.25;
    const c = { x: (sc.x + tc.x) / 2 - dy * k, y: (sc.y + tc.y) / 2 + dx * k };
    const start = s.node ? boundaryPoint(s.node, c, EDGE_GAP) : sc;
    const end = t.node ? boundaryPoint(t.node, c, EDGE_GAP) : tc;
    const pts: Point[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const e = u * u;
      pts.push({ x: a * start.x + b * c.x + e * end.x, y: a * start.y + b * c.y + e * end.y });
    }
    const q = (p0: Point, p1: Point) => `M${fmt(p0.x)} ${fmt(p0.y)} Q${fmt(c.x)} ${fmt(c.y)} ${fmt(p1.x)} ${fmt(p1.y)}`;
    return finish(pts, q(start, end), q(end, start));
  }

  const start = s.node ? boundaryPoint(s.node, tc, EDGE_GAP) : sc;
  const end = t.node ? boundaryPoint(t.node, sc, EDGE_GAP) : tc;
  const pts = [start, end];
  return finish(pts, pathFromPoints(pts), pathFromPoints([end, start]));
}

export function arrowHeadPath(tip: Point, dir: Point, size: number): string {
  const a = Math.atan2(dir.y, dir.x);
  const spread = 0.45;
  const w1 = { x: tip.x - size * Math.cos(a - spread), y: tip.y - size * Math.sin(a - spread) };
  const w2 = { x: tip.x - size * Math.cos(a + spread), y: tip.y - size * Math.sin(a + spread) };
  return `M${fmt(w1.x)} ${fmt(w1.y)} L${fmt(tip.x)} ${fmt(tip.y)} L${fmt(w2.x)} ${fmt(w2.y)}`;
}

export function distanceToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

export function nodeContains(n: NodeElement, p: Point, tolerance = 0): boolean {
  const c = center(n);
  const hw = n.width / 2 + tolerance;
  const hh = n.height / 2 + tolerance;
  const dx = Math.abs(p.x - c.x);
  const dy = Math.abs(p.y - c.y);
  if (n.shape === 'ellipse') return (dx / hw) ** 2 + (dy / hh) ** 2 <= 1;
  if (n.shape === 'diamond') return dx / hw + dy / hh <= 1;
  return dx <= hw && dy <= hh;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function diagramBounds(d: Diagram): Bounds | null {
  if (!d.nodes.length && !d.edges.length) return null;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const n of d.nodes) {
    add(n.x, n.y);
    add(n.x + n.width, n.y + n.height);
  }
  const nodes = nodeMap(d.nodes);
  for (const e of d.edges) {
    const g = edgeGeometry(e, nodes);
    for (const p of g.points) add(p.x, p.y);
    if (e.label) {
      const w = (e.label.length * e.fontSize * 0.6) / 2;
      add(g.mid.x - w, g.mid.y - e.fontSize);
      add(g.mid.x + w, g.mid.y + e.fontSize);
    }
  }
  return b;
}

/** Distance (px) en deçà de laquelle une extrémité de flèche libre est raccrochée à une forme */
export const SNAP_DISTANCE = 16;

/**
 * Forme à laquelle raccrocher une extrémité libre : la plus petite forme (hors texte) dont le contour est à moins
 * de `tolerance` du point — la plus petite pour viser la boîte plutôt qu'un grand cadre qui la contient.
 */
export function findSnapNode(p: Point, nodes: NodeElement[], exclude?: string, tolerance = SNAP_DISTANCE): NodeElement | undefined {
  let best: NodeElement | undefined;
  for (const n of nodes) {
    if (n.id === exclude || n.shape === 'text' || !nodeContains(n, p, tolerance)) continue;
    if (!best || n.width * n.height < best.width * best.height) best = n;
  }
  return best;
}

/** Raccroche les extrémités libres d'un lien aux formes proches ; renvoie le lien (inchangé si rien à faire). */
export function snapEdge(e: EdgeElement, nodes: NodeElement[]): EdgeElement {
  let { source, target } = e;
  const attach = (n: NodeElement) => ({ nodeId: n.id, x: n.x + n.width / 2, y: n.y + n.height / 2 });
  if (!source.nodeId) {
    const n = findSnapNode(source, nodes, target.nodeId);
    if (n) source = attach(n);
  }
  if (!target.nodeId) {
    const n = findSnapNode(target, nodes, source.nodeId);
    if (n) target = attach(n);
  }
  return source === e.source && target === e.target ? e : { ...e, source, target };
}

/** Lien retourné : extrémités et pointes échangées, même tracé (courbure opposée). */
export function reverseEdge(e: EdgeElement): EdgeElement {
  const heads = { end: 'start', start: 'end', both: 'both', none: 'none' } as const;
  return {
    ...e,
    source: e.target,
    target: e.source,
    arrowHeads: heads[e.arrowHeads],
    curvature: e.curvature === undefined ? undefined : -e.curvature,
  };
}

/** Espacement des rappels de nom le long d'un lien, et distance au départ du premier rappel */
export const REPEAT_SPACING = 400;
const REPEAT_FIRST = 260;

/** Le segment [a, b] traverse-t-il le rectangle ? (Liang–Barsky) */
function segmentHitsBox(a: Point, b: Point, r: Bounds): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.minX) && clip(dx, r.maxX - a.x) && clip(-dy, a.y - r.minY) && clip(dy, r.maxY - a.y);
}

export interface RepeatObstacles {
  /** Tracés des autres liens */
  lines: Point[][];
  /** Zones occupées (libellés, formes) */
  boxes: Bounds[];
}

/**
 * Positions des rappels de nom le long d'un lien (aucune si le lien est trop court). Chaque rappel est décalé le
 * long du lien jusqu'à une place libre, sans croiser d'autre lien ni libellé ; sans place libre, il est omis.
 */
export function repeatPositions(g: EdgeGeometry, size = { width: 80, height: 20 }, obstacles: RepeatObstacles = { lines: [], boxes: [] }): Point[] {
  const out: Point[] = [];
  const free = (p: Point) => {
    const r = { minX: p.x - size.width / 2, maxX: p.x + size.width / 2, minY: p.y - size.height / 2, maxY: p.y + size.height / 2 };
    if (obstacles.boxes.some((b) => b.minX < r.maxX && r.minX < b.maxX && b.minY < r.maxY && r.minY < b.maxY)) return false;
    return !obstacles.lines.some((pts) => pts.some((q, i) => i > 0 && segmentHitsBox(pts[i - 1], q, r)));
  };
  for (let l = REPEAT_FIRST; l <= g.length - 120; l += REPEAT_SPACING) {
    for (let k = 0; k <= REPEAT_SPACING / 2; k += 6) {
      const offsets = k === 0 ? [0] : [k, -k];
      const hit = offsets.map((o) => l + o).find((pos) => pos > 60 && pos < g.length - 40 && free(pointAtLength(g.points, pos)));
      if (hit !== undefined) {
        out.push(pointAtLength(g.points, hit));
        break;
      }
    }
  }
  return out;
}
