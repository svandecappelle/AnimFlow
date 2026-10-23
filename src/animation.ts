/**
 * Calcul des timings des animations SMIL.
 *
 * Toutes les animations sont exprimées en SMIL (<animate>, <animateMotion>…) plutôt qu'en CSS :
 * le même balisage fonctionne dans l'éditeur et dans le SVG exporté, et `svg.pauseAnimations()`
 * / `setCurrentTime()` pilotent l'ensemble d'un coup.
 *
 * Deux modes :
 *  - boucle : chaque lien anime indépendamment, `delay` décale simplement le départ ;
 *  - séquence : un cycle global de durée T ; chaque lien n'est actif que sur sa fenêtre
 *    [delay, delay + duration], puis tout recommence. Idéal pour raconter un flux étape par étape.
 */
import type { Diagram, DiagramSettings, EdgeElement } from './types';

const EPS = 1e-4;
const f = (n: number) => String(Math.round(n * 10000) / 10000);

export interface AnimWindow {
  /** Durée SMIL (secondes) */
  dur: number;
  /** Début / fin de la fenêtre active, en fraction de `dur` */
  start: number;
  end: number;
  /** Attribut `begin` (secondes) */
  begin: number;
}

/**
 * Durée d'un cycle en mode séquence : fin du dernier élément minuté + pause de fin de cycle.
 * Éléments minutés : liens animés, liens « apparition » non animés, formes à instant d'apparition imposé
 * (les formes « Auto » apparaissent à la fin d'un flux, déjà compté).
 */
export function sequenceCycle(d: Diagram): number {
  let m = 0;
  for (const e of d.edges) {
    if (e.animation.type !== 'none') m = Math.max(m, e.animation.delay + e.animation.duration);
    else if (e.reveal) m = Math.max(m, e.animation.delay + REVEAL_DURATION);
  }
  for (const n of d.nodes) {
    if (n.reveal !== 'none' && n.revealDelay != null) m = Math.max(m, n.revealDelay + REVEAL_DURATION);
  }
  return Math.max(0.5, m + d.settings.sequenceGap);
}

export function edgeWindow(e: EdgeElement, settings: DiagramSettings, cycle: number): AnimWindow {
  const a = e.animation;
  if (settings.sequence) {
    const start = Math.min(1, a.delay / cycle);
    return { dur: cycle, start, end: Math.min(1, Math.max(start + EPS * 10, (a.delay + a.duration) / cycle)), begin: 0 };
  }
  // Mode boucle : l'animation dure `duration`, puis repos de `loopPause` avant la répétition suivante
  // (le tracé progressif reste en plus affiché un moment avant de recommencer)
  const active = a.duration;
  const rest = (a.type === 'draw' ? a.duration * 0.5 : 0) + Math.max(0, settings.loopPause);
  return { dur: active + rest, start: 0, end: active / (active + rest), begin: a.delay };
}

export interface Keys {
  values: string;
  keyTimes: string;
}

/** Interpolation linéaire : `before` jusqu'à start, `atStart`→`atEnd` pendant la fenêtre, puis `after`. */
export function linearKeys(before: number, atStart: number, atEnd: number, after: number, s: number, e: number): Keys {
  let pairs: [number, number][] = [
    [0, before],
    [s, atStart],
    [Math.max(e, s + EPS), atEnd],
    [1, after],
  ];
  if (s <= EPS) {
    pairs = pairs.slice(1);
    pairs[0][0] = 0;
  }
  if (pairs[pairs.length - 2][0] >= 1 - EPS) {
    pairs = pairs.slice(0, -1);
    pairs[pairs.length - 1][0] = 1;
  }
  return { values: pairs.map((p) => f(p[1])).join(';'), keyTimes: pairs.map((p) => f(p[0])).join(';') };
}

export function mergeWindows(windows: [number, number][]): [number, number][] {
  const sorted = windows
    .map(([s, e]) => [Math.max(0, s), Math.min(1, e)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else out.push([...w]);
  }
  return out;
}

/** Visibilité discrète (0/1) : visible uniquement pendant les fenêtres. Renvoie un nombre si constant. */
export function discreteVisibility(windows: [number, number][]): Keys | number {
  const ks: number[] = [];
  const vs: number[] = [];
  const push = (k: number, v: number) => {
    if (ks.length && Math.abs(ks[ks.length - 1] - k) < EPS) {
      vs[vs.length - 1] = v;
      if (vs.length > 1 && vs[vs.length - 2] === v) {
        ks.pop();
        vs.pop();
      }
      return;
    }
    if (vs.length && vs[vs.length - 1] === v) return;
    ks.push(k);
    vs.push(v);
  };
  push(0, 0);
  for (const [s, e] of mergeWindows(windows)) {
    push(s, 1);
    if (e < 1 - EPS) push(e, 0);
  }
  if (vs.length === 1) return vs[0];
  return { values: vs.join(';'), keyTimes: ks.map(f).join(';') };
}

/** Impulsions linéaires low → high → low centrées sur chaque fenêtre. */
export function pulseKeys(windows: [number, number][], low: number, high: number): Keys | null {
  const merged = mergeWindows(windows);
  if (!merged.length) return null;
  const pairs: [number, number][] = [[0, low]];
  for (const [s, e] of merged) {
    pairs.push([s, low], [(s + e) / 2, high], [e, low]);
  }
  pairs.push([1, low]);
  const clean = pairs.filter((p, i) => i === 0 || p[0] !== pairs[i - 1][0] || p[1] !== pairs[i - 1][1]);
  return { values: clean.map((p) => f(p[1])).join(';'), keyTimes: clean.map((p) => f(p[0])).join(';') };
}

/** Fenêtres pendant lesquelles un nœud « reçoit » un flux (fin des liens entrants animés), en mode séquence. */
export function arrivalWindows(d: Diagram, nodeId: string, cycle: number, hold = 0.8): [number, number][] {
  return d.edges
    .filter((e) => e.target.nodeId === nodeId && e.animation.type !== 'none')
    .map((e) => {
      const t = e.animation.delay + e.animation.duration;
      return [t / cycle, (t + hold) / cycle] as [number, number];
    });
}

/**
 * Calcule automatiquement les délais pour que chaque lien démarre quand le flux arrive à son nœud source
 * (plus long chemin depuis les sources, en ignorant les arcs retour des cycles). Active le mode séquence.
 */
export function autoSequence(d: Diagram, gap = d.settings.stepPause): Diagram {
  const animated = d.edges.filter((e) => e.animation.type !== 'none');
  const out = new Map<string, EdgeElement[]>();
  const incoming = new Set<string>();
  for (const e of animated) {
    if (!e.source.nodeId) continue;
    out.set(e.source.nodeId, [...(out.get(e.source.nodeId) ?? []), e]);
    if (e.target.nodeId) incoming.add(e.target.nodeId);
  }

  // Détection des arcs retour (DFS) pour casser les cycles
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const t = e.target.nodeId;
      if (!t) continue;
      const s = state.get(t);
      if (s === 1) back.add(e.id);
      else if (!s) visit(t);
    }
    state.set(id, 2);
  };
  const roots = [...d.nodes].sort((a, b) => Number(incoming.has(a.id)) - Number(incoming.has(b.id)));
  for (const n of roots) if (!state.has(n.id)) visit(n.id);

  const ready = new Map<string, number>();
  for (let i = 0; i <= d.nodes.length; i++) {
    let changed = false;
    for (const e of animated) {
      if (back.has(e.id) || !e.target.nodeId) continue;
      const start = (e.source.nodeId ? (ready.get(e.source.nodeId) ?? 0) : 0) + e.animation.extraPause;
      const arrival = start + e.animation.duration + gap;
      if (arrival > (ready.get(e.target.nodeId) ?? 0) + EPS) {
        ready.set(e.target.nodeId, arrival);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return {
    ...d,
    settings: { ...d.settings, sequence: true, manualOrder: false },
    edges: d.edges.map((e) => {
      if (e.animation.type === 'none') return e;
      const delay = (e.source.nodeId ? (ready.get(e.source.nodeId) ?? 0) : 0) + e.animation.extraPause;
      return { ...e, animation: { ...e.animation, delay: Math.round(delay * 100) / 100 } };
    }),
  };
}

/** Durée de l'effet d'apparition (secondes) */
export const REVEAL_DURATION = 0.45;

export interface RevealTimes {
  nodes: Map<string, number>;
  edges: Map<string, number>;
}

/**
 * Instants d'apparition (secondes dans le cycle) en mode séquence.
 * Une forme `reveal` apparaît à l'arrivée du premier flux entrant (fin d'un lien animé, ou apparition de la source
 * d'un lien non animé) ; une forme sans lien entrant est visible dès le début.
 * Un lien touchant une forme `reveal` apparaît quand son flux démarre (ou quand ses deux extrémités sont visibles).
 */
export function revealTimes(d: Diagram): RevealTimes {
  const time = new Map<string, number>();
  const incoming = new Map<string, EdgeElement[]>();
  for (const e of d.edges) {
    if (e.target.nodeId && e.target.nodeId !== e.source.nodeId) {
      incoming.set(e.target.nodeId, [...(incoming.get(e.target.nodeId) ?? []), e]);
    }
  }
  for (const n of d.nodes) time.set(n.id, incoming.has(n.id) ? Infinity : 0);
  const relax = () => {
    // Relaxation « plus tôt possible » (stable en présence de cycles)
    for (let i = 0; i <= d.nodes.length; i++) {
      let changed = false;
      for (const [id, edges] of incoming) {
        let best = time.get(id) ?? Infinity;
        for (const e of edges) {
          const src = e.source.nodeId ? (time.get(e.source.nodeId) ?? 0) : 0;
          const t = e.animation.type !== 'none' ? Math.max(src, e.animation.delay + e.animation.duration) : src;
          best = Math.min(best, t);
        }
        if (best < (time.get(id) ?? Infinity) - EPS) {
          time.set(id, best);
          changed = true;
        }
      }
      if (!changed) break;
    }
  };
  relax();
  // Une forme atteignable seulement par un cycle (aucune vraie source en amont) sert de point de départ
  for (let unreached = d.nodes.find((n) => time.get(n.id) === Infinity); unreached; unreached = d.nodes.find((n) => time.get(n.id) === Infinity)) {
    time.set(unreached.id, 0);
    relax();
  }

  const revealed = new Map(d.nodes.filter((n) => n.reveal !== 'none').map((n) => [n.id, n]));
  const nodes = new Map<string, number>();
  for (const [id, n] of revealed) {
    // Instant imposé : masqué jusque-là, même à 0 s (état initial d'une présentation) ; formes de départ « Auto » visibles
    if (n.revealDelay != null) nodes.set(id, n.revealDelay);
    else {
      const t = time.get(id) ?? 0;
      if (t > EPS && Number.isFinite(t)) nodes.set(id, t);
    }
  }
  const edges = new Map<string, number>();
  for (const e of d.edges) {
    if (e.reveal) {
      // Apparition demandée explicitement : masqué jusqu'au démarrage, même à 0 s
      edges.set(e.id, e.animation.delay);
      continue;
    }
    if (!revealed.has(e.source.nodeId ?? '') && !revealed.has(e.target.nodeId ?? '')) continue;
    const src = nodes.get(e.source.nodeId ?? '') ?? 0;
    const t = e.animation.type !== 'none' ? Math.max(src, e.animation.delay) : Math.max(src, nodes.get(e.target.nodeId ?? '') ?? 0);
    if (t > EPS) edges.set(e.id, t);
  }
  return { nodes, edges };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Re-minute un schéma en mode séquence avec la pause `settings.stepPause`, en conservant l'enchaînement existant :
 *  - un flux partant d'une forme redémarre `stepPause + extraPause` après la nouvelle fin du dernier flux arrivé
 *    sur cette forme — les jonctions (attendre le plus long de plusieurs flux) sont conservées ;
 *  - un flux libre (sans forme de départ) suit le dernier flux terminé avant lui, ou garde son décalage par rapport
 *    au flux pendant lequel il démarrait (messages simultanés) ;
 *  - les flux de départ gardent leur délai.
 * Les autres instants (apparitions imposées, séparateurs) suivent le flux qui les précède.
 */
export function retime(d: Diagram): Diagram {
  // Ordre manuel : on garde les étapes telles quelles, seul l'espacement change
  if (d.settings.manualOrder) return applyStepOrder(d, sequenceSteps(d).map((s) => s.items.map((i) => i.id)));
  const pause = Math.max(0, d.settings.stepPause);
  const anim = d.edges.filter((e) => e.animation.type !== 'none').sort((a, b) => a.animation.delay - b.animation.delay);
  if (!anim.length) return d;
  const oldEnd = (e: EdgeElement) => e.animation.delay + e.animation.duration;
  const newStart = new Map<string, number>();
  const done: EdgeElement[] = [];
  for (const e of anim) {
    const s = e.animation.delay;
    // Lien partant d'une forme : déclenché par le dernier flux arrivé sur cette forme (structure du graphe).
    // Lien libre (ex. message de diagramme de séquence) : par le dernier flux terminé avant lui.
    const src = e.source.nodeId;
    const candidates = src ? done.filter((p) => p.target.nodeId === src) : done;
    let trigger: EdgeElement | undefined;
    let anchor: EdgeElement | undefined;
    // Parmi les flux terminés avant lui, celui qui finit le plus tard après re-minutage
    const newEnd = (p: EdgeElement) => newStart.get(p.id)! + p.animation.duration;
    for (const p of candidates) {
      if (oldEnd(p) <= s + EPS && (!trigger || newEnd(p) > newEnd(trigger))) trigger = p;
    }
    if (!src) {
      for (const p of done) if (p.animation.delay <= s + EPS && (!anchor || p.animation.delay >= anchor.animation.delay)) anchor = p;
    }
    let t: number;
    if (trigger) t = newStart.get(trigger.id)! + trigger.animation.duration + pause + e.animation.extraPause;
    else if (anchor) t = newStart.get(anchor.id)! + (s - anchor.animation.delay);
    else t = s;
    newStart.set(e.id, round2(t));
    done.push(e);
  }

  // Correspondance ancien instant → nouvel instant, par décalage depuis le repère précédent
  const marks = anim
    .flatMap((e) => [
      [e.animation.delay, newStart.get(e.id)!],
      [oldEnd(e), newStart.get(e.id)! + e.animation.duration],
    ])
    .sort((a, b) => a[0] - b[0]);
  const map = (t: number) => {
    let m = marks[0];
    for (const k of marks) if (k[0] <= t + EPS) m = k;
    return round2(Math.max(0, t <= marks[0][0] ? t : m[1] + (t - m[0])));
  };

  return {
    ...d,
    nodes: d.nodes.map((n) => (n.revealDelay != null ? { ...n, revealDelay: map(n.revealDelay) } : n)),
    edges: d.edges.map((e) => {
      const ns = newStart.get(e.id);
      if (ns !== undefined) return { ...e, animation: { ...e.animation, delay: ns } };
      return e.animation.delay ? { ...e, animation: { ...e.animation, delay: map(e.animation.delay) } } : e;
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Étapes de la séquence (panneau « Ordre des étapes »)

export interface StepItem {
  kind: 'edge' | 'node';
  id: string;
  start: number;
  /** Durée de l'animation (ou de l'effet d'apparition) */
  duration: number;
}

export interface SequenceStep {
  start: number;
  end: number;
  /** Éléments qui démarrent ensemble (réordonnables) */
  items: StepItem[];
  /** Formes « Auto » qui apparaissent à l'arrivée d'un flux de cette étape (suivent automatiquement) */
  arrivals: string[];
}

const SAME_STEP = 0.05;

/**
 * Découpe la séquence en étapes. Éléments ordonnables : liens animés, liens « apparition » non animés, formes à
 * instant d'apparition imposé. Les formes « Auto » sont rattachées à l'étape dont un flux arrive sur elles.
 */
export function sequenceSteps(d: Diagram): SequenceStep[] {
  const items: StepItem[] = [];
  for (const e of d.edges) {
    if (e.animation.type !== 'none') items.push({ kind: 'edge', id: e.id, start: e.animation.delay, duration: e.animation.duration });
    else if (e.reveal) items.push({ kind: 'edge', id: e.id, start: e.animation.delay, duration: REVEAL_DURATION });
  }
  for (const n of d.nodes) {
    if (n.reveal !== 'none' && n.revealDelay != null) items.push({ kind: 'node', id: n.id, start: n.revealDelay, duration: REVEAL_DURATION });
  }
  // Tri stable : à instant égal, l'ordre du schéma (liens puis formes)
  items.sort((a, b) => a.start - b.start);
  const steps: SequenceStep[] = [];
  for (const it of items) {
    const last = steps[steps.length - 1];
    if (last && Math.abs(it.start - last.start) < SAME_STEP) {
      last.items.push(it);
      last.end = Math.max(last.end, it.start + it.duration);
    } else steps.push({ start: it.start, end: it.start + it.duration, items: [it], arrivals: [] });
  }

  const reveal = revealTimes(d).nodes;
  for (const n of d.nodes) {
    if (n.reveal === 'none' || n.revealDelay != null) continue;
    const t = reveal.get(n.id);
    if (t === undefined || !steps.length) continue;
    // Étape dont un flux entrant se termine à l'arrivée, sinon la dernière étape commencée avant
    const byArrival = steps.find((s) =>
      s.items.some((i) => i.kind === 'edge' && Math.abs(i.start + i.duration - t) < SAME_STEP && d.edges.find((e) => e.id === i.id)?.target.nodeId === n.id),
    );
    const fallback = [...steps].reverse().find((s) => s.start <= t + EPS) ?? steps[0];
    (byArrival ?? fallback).arrivals.push(n.id);
  }
  return steps;
}

/**
 * Applique un ordre d'étapes (identifiants par étape) : minutage linéaire, chaque étape démarre après la fin de
 * la précédente + pause (+ la plus grande pause supplémentaire de ses liens). Passe le schéma en ordre manuel.
 */
export function applyStepOrder(d: Diagram, order: string[][]): Diagram {
  const pause = Math.max(0, d.settings.stepPause);
  const edges = new Map(d.edges.map((e) => [e.id, e]));
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const startOf = new Map<string, number>();
  let prevEnd: number | null = null;
  for (const ids of order.filter((s) => s.length)) {
    const extra = Math.max(0, ...ids.map((id) => edges.get(id)?.animation.extraPause ?? 0));
    const start: number = prevEnd === null ? extra : prevEnd + pause + extra;
    let end: number = start;
    for (const id of ids) {
      startOf.set(id, round2(start));
      const e = edges.get(id);
      end = Math.max(end, start + (e && e.animation.type !== 'none' ? e.animation.duration : REVEAL_DURATION));
    }
    prevEnd = end;
  }
  return {
    ...d,
    settings: { ...d.settings, sequence: true, manualOrder: true },
    edges: d.edges.map((e) => (startOf.has(e.id) ? { ...e, animation: { ...e.animation, delay: startOf.get(e.id)! } } : e)),
    nodes: d.nodes.map((n) => {
      const t = startOf.get(n.id);
      if (t === undefined || !nodes.has(n.id)) return n;
      return { ...n, revealDelay: t, reveal: n.reveal === 'none' ? 'fade' : n.reveal };
    }),
  };
}

/**
 * Instant où l'étape `i` est entièrement jouée (ses animations et les apparitions qu'elle déclenche), sans entamer
 * l'étape suivante. `i = -1` : état initial, avant la première étape.
 */
export function stepHoldTime(steps: SequenceStep[], i: number): number {
  if (i < 0 || !steps.length) return 0;
  const s = steps[Math.min(i, steps.length - 1)];
  const end = s.end + (s.arrivals.length ? REVEAL_DURATION : 0) + 0.05;
  const next = steps[i + 1];
  return next ? Math.max(s.start, Math.min(end, next.start - 0.02)) : end;
}

// ---------------------------------------------------------------------------------------------------------------
// Notes du présentateur : portées par les éléments d'une étape (elles suivent l'élément quand on réordonne)

const noteOf = (d: Diagram, id: string) => (d.edges.find((e) => e.id === id) ?? d.nodes.find((n) => n.id === id))?.note?.trim() ?? '';

/** Notes d'une étape : celles de ses éléments, dans l'ordre (plusieurs si des étapes ont été fusionnées). */
export function stepNote(d: Diagram, step: SequenceStep): string {
  return step.items
    .map((i) => noteOf(d, i.id))
    .filter(Boolean)
    .join('\n\n');
}

/** Enregistre les notes d'une étape sur son premier élément (les autres éléments de l'étape n'en portent plus). */
export function withStepNote(d: Diagram, itemIds: string[], text: string): Diagram {
  const [lead, ...rest] = itemIds;
  const others = new Set(rest);
  const note = text.trim() ? text : undefined;
  const set = <T extends { id: string; note?: string }>(el: T): T =>
    el.id === lead ? { ...el, note } : others.has(el.id) && el.note !== undefined ? { ...el, note: undefined } : el;
  return { ...d, edges: d.edges.map(set), nodes: d.nodes.map(set) };
}
