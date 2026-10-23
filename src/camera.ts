/**
 * Caméra qui suit l'animation en mode séquence.
 *
 * À chaque instant, la caméra cadre les éléments « actifs » (liens dont le flux est en cours, formes et liens qui
 * viennent d'apparaître), garde le dernier cadrage pendant les temps morts, puis montre une vue d'ensemble en fin
 * de cycle avant de revenir au début. Les images clés sont calculées une fois (fonction pure) et servent :
 *  - dans l'éditeur, à piloter le viewport (`cameraAt`) ;
 *  - dans le SVG exporté, à animer le `viewBox` (SMIL).
 */
import { revealTimes, sequenceCycle } from './animation';
import { diagramBounds, edgeGeometry, nodeMap, type Bounds } from './geometry';
import { measureText } from './text';
import type { CameraMode, Diagram } from './types';
import type { Viewport } from './store';

/** Taille minimale du cadrage, en fraction de la taille totale du schéma */
const MIN_FRACTION: Record<Exclude<CameraMode, 'off'>, number> = { veryClose: 0.1, close: 0.25, medium: 0.45, wide: 0.7 };
/** Durée d'un mouvement de caméra (s) */
export const CAMERA_TRANSITION = 0.7;
/** Durée pendant laquelle un élément qui apparaît reste « actif » (s) */
const APPEAR_FOCUS = 1;
const PADDING = 60;
/** Zoom maximal de la caméra (1 = taille réelle) : garde du contexte autour de l'élément suivi */
export const CAMERA_MAX_ZOOM = 1.6;
/** « Très proche » : zoom autorisé bien au-delà de la taille réelle, pour suivre un détail sur un grand schéma */
export const CAMERA_MAX_ZOOM_VERY_CLOSE = 3;

export const cameraMaxZoom = (mode: CameraMode) => (mode === 'veryClose' ? CAMERA_MAX_ZOOM_VERY_CLOSE : CAMERA_MAX_ZOOM);
const EPS = 1e-3;

export interface CameraKey {
  t: number;
  b: Bounds;
}

const union = (list: Bounds[]): Bounds => ({
  minX: Math.min(...list.map((b) => b.minX)),
  minY: Math.min(...list.map((b) => b.minY)),
  maxX: Math.max(...list.map((b) => b.maxX)),
  maxY: Math.max(...list.map((b) => b.maxY)),
});

/** Agrandit un cadre autour de son centre : marge, taille minimale, puis rapport largeur/hauteur. */
function frame(b: Bounds, minW: number, minH: number, aspect: number, pad = PADDING): Bounds {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  let w = Math.max(b.maxX - b.minX + pad * 2, minW);
  let h = Math.max(b.maxY - b.minY + pad * 2, minH);
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
}

const same = (a: Bounds, b: Bounds) =>
  Math.abs(a.minX - b.minX) < 1 && Math.abs(a.minY - b.minY) < 1 && Math.abs(a.maxX - b.maxX) < 1 && Math.abs(a.maxY - b.maxY) < 1;

/**
 * Images clés de la caméra sur un cycle ; [] si la caméra est inactive.
 * `view` = taille de la vue en pixels écran (canevas visible, ou taille du SVG exporté).
 */
export function cameraKeyframes(d: Diagram, view: { width: number; height: number }): CameraKey[] {
  const aspect = view.width / view.height;
  const mode = d.settings.camera;
  if (mode === 'off' || !d.settings.sequence) return [];
  const all = diagramBounds(d);
  if (!all) return [];
  const cycle = sequenceCycle(d);
  const fullW = all.maxX - all.minX;
  const fullH = all.maxY - all.minY;
  const frac = MIN_FRACTION[mode];
  const maxZoom = cameraMaxZoom(mode);
  const focus = (b: Bounds) =>
    frame(b, Math.max(fullW * frac, view.width / maxZoom), Math.max(fullH * frac, view.height / maxZoom), aspect);
  const overview = frame(all, 0, 0, aspect, PADDING);

  const nodes = nodeMap(d.nodes);
  const nodeBox = (id?: string): Bounds[] => {
    const n = id ? nodes.get(id) : undefined;
    return n ? [{ minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height }] : [];
  };
  const edgeBox = (e: Diagram['edges'][number]): Bounds => {
    const g = edgeGeometry(e, nodes);
    const parts: Bounds[] = g.points.map((p) => ({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }));
    if (e.label) {
      const m = measureText(e.label, e.fontFamily, e.fontSize);
      parts.push({ minX: g.mid.x - m.width / 2, minY: g.mid.y - m.height / 2, maxX: g.mid.x + m.width / 2, maxY: g.mid.y + m.height / 2 });
    }
    return union([...parts, ...nodeBox(e.source.nodeId), ...nodeBox(e.target.nodeId)]);
  };

  // Éléments actifs et leur fenêtre de temps
  const items: { s: number; e: number; b: Bounds }[] = [];
  for (const e of d.edges) {
    const a = e.animation;
    if (a.type !== 'none') items.push({ s: a.delay, e: a.delay + a.duration, b: edgeBox(e) });
    else if (e.reveal && a.delay > 0) items.push({ s: a.delay, e: a.delay + APPEAR_FOCUS, b: edgeBox(e) });
  }
  for (const [id, t] of revealTimes(d).nodes) items.push({ s: t, e: t + APPEAR_FOCUS, b: nodeBox(id)[0] });
  if (!items.length) return [];

  const lastEnd = Math.min(cycle, Math.max(...items.map((i) => i.e)));
  const times = [...new Set(items.flatMap((i) => [i.s, i.e]))].filter((t) => t < lastEnd - EPS).sort((a, b) => a - b);
  const states: CameraKey[] = [];
  for (const t of times) {
    const active = items.filter((i) => i.s <= t + EPS && i.e > t + EPS);
    if (!active.length) continue; // temps mort : on garde le cadrage précédent
    const b = focus(union(active.map((i) => i.b)));
    if (!states.length || !same(states[states.length - 1].b, b)) states.push({ t, b });
  }
  if (!states.length) return [];

  const keys: CameraKey[] = [{ t: 0, b: states[0].b }];
  for (let i = 1; i < states.length; i++) {
    const next = states[i + 1]?.t ?? lastEnd;
    keys.push({ t: states[i].t, b: states[i - 1].b }, { t: Math.min(states[i].t + CAMERA_TRANSITION, next), b: states[i].b });
  }
  // Fin de cycle : vue d'ensemble, puis retour au premier cadrage pour boucler sans saut
  const last = states[states.length - 1].b;
  // Pause courte : transitions raccourcies pour que la vue d'ensemble soit tenue au moins un tiers de la pause
  const tr = Math.min(CAMERA_TRANSITION, (cycle - lastEnd) / 3);
  const overviewStart = lastEnd + tr;
  const overviewEnd = Math.max(overviewStart, cycle - tr);
  keys.push({ t: lastEnd, b: last }, { t: overviewStart, b: overview }, { t: overviewEnd, b: overview }, { t: cycle, b: states[0].b });

  // Temps strictement croissants dans [0, cycle]
  const out: CameraKey[] = [];
  for (const k of keys) {
    const prev = out[out.length - 1];
    const t = Math.min(cycle, prev ? Math.max(k.t, prev.t + EPS) : 0);
    if (prev && t - prev.t < EPS) continue;
    out.push({ t, b: k.b });
  }
  out[out.length - 1].t = cycle;
  return out;
}

const ease = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Cadrage de la caméra à l'instant t (secondes, modulo le cycle). */
export function cameraAt(keys: CameraKey[], t: number): Bounds | null {
  if (!keys.length) return null;
  const cycle = keys[keys.length - 1].t;
  const tt = ((t % cycle) + cycle) % cycle;
  for (let i = 1; i < keys.length; i++) {
    if (tt <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      const u = ease(Math.max(0, Math.min(1, (tt - a.t) / (b.t - a.t || 1))));
      return {
        minX: lerp(a.b.minX, b.b.minX, u),
        minY: lerp(a.b.minY, b.b.minY, u),
        maxX: lerp(a.b.maxX, b.b.maxX, u),
        maxY: lerp(a.b.maxY, b.b.maxY, u),
      };
    }
  }
  return keys[keys.length - 1].b;
}

/** Valeurs SMIL pour animer le viewBox d'un SVG exporté (même courbe que l'éditeur). */
export function cameraSmil(keys: CameraKey[]): { values: string; keyTimes: string; keySplines: string; dur: number } | null {
  if (keys.length < 2) return null;
  const cycle = keys[keys.length - 1].t;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    values: keys.map(({ b }) => `${r(b.minX)} ${r(b.minY)} ${r(b.maxX - b.minX)} ${r(b.maxY - b.minY)}`).join(';'),
    keyTimes: keys.map((k) => String(Math.round((k.t / cycle) * 10000) / 10000)).join(';'),
    keySplines: keys.slice(1).map(() => '0.5 0 0.5 1').join(';'),
    dur: cycle,
  };
}

/** Marges du canevas masquées par l'interface (pixels écran) */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Marges masquées par l'interface : barre d'outils et panneau des documents (gauche), panneau de propriétés
 * (droite), timeline (bas). En présentation, seule la barre de navigation du bas est à éviter.
 */
export const canvasInsets = (opts: { sidebarOpen: boolean; presenting: boolean }): Insets =>
  opts.presenting
    ? { left: 40, right: 40, top: 40, bottom: 90 }
    : { left: opts.sidebarOpen ? 80 + 284 : 80, right: 310, top: 30, bottom: 80 };

const DEFAULT_INSETS = canvasInsets({ sidebarOpen: false, presenting: false });

/** Zone du canevas non masquée par l'interface. */
export function visibleArea(rect: { width: number; height: number }, insets: Insets = DEFAULT_INSETS) {
  return {
    left: insets.left,
    top: insets.top,
    width: Math.max(100, rect.width - insets.left - insets.right),
    height: Math.max(100, rect.height - insets.top - insets.bottom),
  };
}

/** Viewport qui cadre `b` dans la zone visible du canevas. */
export function fitViewport(b: Bounds, rect: { width: number; height: number }, maxZoom = 1.5, insets: Insets = DEFAULT_INSETS): Viewport {
  const area = visibleArea(rect, insets);
  const zoom = Math.min(maxZoom, Math.max(0.05, Math.min(area.width / (b.maxX - b.minX || 1), area.height / (b.maxY - b.minY || 1))));
  return {
    zoom,
    x: area.left + area.width / 2 - ((b.minX + b.maxX) / 2) * zoom,
    y: area.top + area.height / 2 - ((b.minY + b.maxY) / 2) * zoom,
  };
}
