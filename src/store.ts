import { create } from 'zustand';
import { normalizeDiagram } from './defaults';
import { createExampleDiagram } from './example';
import type { Diagram } from './types';

export type Tool = 'select' | 'hand' | 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'arrow' | 'text';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

const HISTORY_LIMIT = 100;
const STORAGE_KEY = 'animflow:diagram';

interface State {
  diagram: Diagram;
  selectedIds: string[];
  tool: Tool;
  viewport: Viewport;
  past: Diagram[];
  future: Diagram[];
  playing: boolean;
  restartToken: number;
  editingId: string | null;
  /** La caméra de suivi est mise en pause après une action manuelle sur la vue (zoom, déplacement) */
  cameraSuspended: boolean;

  setTool(tool: Tool): void;
  select(ids: string[]): void;
  setViewport(v: Viewport): void;
  setPlaying(p: boolean): void;
  restart(): void;
  setEditing(id: string | null): void;
  setCameraSuspended(s: boolean): void;
  /** Mémorise l'état courant dans l'historique (à appeler avant une série de `apply`). */
  pushHistory(): void;
  /** Modifie le diagramme sans créer d'entrée d'historique. */
  apply(fn: (d: Diagram) => Diagram): void;
  /** Modifie le diagramme en créant une entrée d'historique. */
  commit(fn: (d: Diagram) => Diagram): void;
  /** Remplace le diagramme (annulable). */
  load(d: Diagram): void;
  undo(): void;
  redo(): void;
}

function loadInitial(): Diagram {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeDiagram(JSON.parse(raw));
  } catch {
    // stockage indisponible ou contenu corrompu : on repart de l'exemple
  }
  return createExampleDiagram();
}

const existing = (d: Diagram, ids: string[]) => {
  const all = new Set([...d.nodes.map((n) => n.id), ...d.edges.map((e) => e.id)]);
  return ids.filter((id) => all.has(id));
};

export const useStore = create<State>((set, get) => ({
  diagram: loadInitial(),
  selectedIds: [],
  tool: 'select',
  viewport: { x: 0, y: 0, zoom: 1 },
  past: [],
  future: [],
  playing: true,
  restartToken: 0,
  editingId: null,
  cameraSuspended: false,

  setTool: (tool) => set({ tool }),
  select: (selectedIds) => set({ selectedIds }),
  setViewport: (viewport) => set({ viewport }),
  setPlaying: (playing) => set(playing ? { playing, cameraSuspended: false } : { playing }),
  restart: () => set((s) => ({ restartToken: s.restartToken + 1, cameraSuspended: false })),
  setEditing: (editingId) => set({ editingId }),
  setCameraSuspended: (cameraSuspended) => set({ cameraSuspended }),

  pushHistory: () => set((s) => ({ past: [...s.past, s.diagram].slice(-HISTORY_LIMIT), future: [] })),
  apply: (fn) => set((s) => ({ diagram: fn(s.diagram) })),
  commit: (fn) => {
    get().pushHistory();
    get().apply(fn);
  },
  load: (d) => {
    get().pushHistory();
    set({ diagram: d, selectedIds: [], editingId: null });
  },
  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        future: [s.diagram, ...s.future],
        diagram: prev,
        selectedIds: existing(prev, s.selectedIds),
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      return {
        past: [...s.past, s.diagram],
        future: s.future.slice(1),
        diagram: next,
        selectedIds: existing(next, s.selectedIds),
      };
    }),
}));

// Sauvegarde automatique dans le navigateur
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.diagram === prev.diagram) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s.diagram));
    } catch {
      // quota dépassé / navigation privée : la sauvegarde auto est best-effort
    }
  }, 400);
});

/** Élément <svg> du canevas (pour pause/lecture et export). */
let svgElement: SVGSVGElement | null = null;
export const setCanvasSvg = (el: SVGSVGElement | null) => {
  svgElement = el;
};
export const getCanvasSvg = () => svgElement;
