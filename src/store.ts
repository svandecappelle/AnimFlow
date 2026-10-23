import { create } from 'zustand';
import { createExampleDiagram } from './example';
import type { Diagram } from './types';
import { docMeta, loadIndex, saveDoc, saveIndex, type Workspace } from './workspace';

export type Tool = 'select' | 'hand' | 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'arrow' | 'text';

/** Participant distant d'une session de collaboration */
export interface Peer {
  clientId: number;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: string[];
}

export interface CollabInfo {
  room: string;
  status: 'connecting' | 'connected' | 'disconnected';
  canUndo: boolean;
  canRedo: boolean;
}

/** En collaboration, annuler/rétablir est délégué (seules les modifications locales sont annulées). */
interface HistoryDelegate {
  /** Début d'une nouvelle étape d'annulation */
  mark(): void;
  undo(): void;
  redo(): void;
}
let historyDelegate: HistoryDelegate | null = null;
export const setHistoryDelegate = (d: HistoryDelegate | null) => {
  historyDelegate = d;
};

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

const HISTORY_LIMIT = 100;

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
  workspaces: Workspace[];
  currentWorkspaceId: string;
  currentDocId: string;
  sidebarOpen: boolean;
  /** La dernière sauvegarde a échoué (stockage du navigateur plein) */
  storageFull: boolean;
  collab: CollabInfo | null;
  peers: Peer[];
  /** Message d'information temporaire */
  toast: string | null;
  rightTab: 'props' | 'order';

  setTool(tool: Tool): void;
  select(ids: string[]): void;
  setViewport(v: Viewport): void;
  setPlaying(p: boolean): void;
  restart(): void;
  setEditing(id: string | null): void;
  setCameraSuspended(s: boolean): void;
  setSidebarOpen(open: boolean): void;
  setCollab(patch: Partial<CollabInfo> | null): void;
  setPeers(peers: Peer[]): void;
  notify(message: string): void;
  setRightTab(tab: 'props' | 'order'): void;
  /** Met à jour l'index des workspaces (persisté immédiatement). */
  setWorkspaces(patch: Partial<Pick<State, 'workspaces' | 'currentWorkspaceId' | 'currentDocId'>>): void;
  /** Bascule vers un autre document : sauvegarde le courant, conserve son historique d'annulation. */
  switchDocument(docId: string, workspaceId: string, diagram: Diagram): void;
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

const existing = (d: Diagram, ids: string[]) => {
  const all = new Set([...d.nodes.map((n) => n.id), ...d.edges.map((e) => e.id)]);
  return ids.filter((id) => all.has(id));
};

const initial = loadIndex(createExampleDiagram);
let toastTimer: ReturnType<typeof setTimeout> | undefined = initial.migrated
  ? setTimeout(() => useStore.setState({ toast: null }), 8000)
  : undefined;
/** Historiques d'annulation des documents non ouverts (en mémoire, le temps de la session) */
const histories = new Map<string, { past: Diagram[]; future: Diagram[] }>();

export const useStore = create<State>((set, get) => ({
  diagram: initial.diagram,
  workspaces: initial.index.workspaces,
  currentWorkspaceId: initial.index.currentWorkspaceId,
  currentDocId: initial.index.currentDocId,
  sidebarOpen: false,
  storageFull: false,
  collab: null,
  peers: [],
  toast:
    initial.migrated > 0
      ? `Colonnes activées sur ${initial.migrated} diagramme${initial.migrated > 1 ? 's' : ''} de séquence : en-têtes collants et noms rappelés le long des lignes de vie.`
      : null,
  rightTab: 'props',
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
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setCollab: (patch) =>
    set((s) => ({
      collab: patch === null ? null : ({ ...(s.collab ?? { room: '', status: 'connecting', canUndo: false, canRedo: false }), ...patch } as CollabInfo),
      ...(patch === null ? { peers: [] } : {}),
    })),
  setPeers: (peers) => set({ peers }),
  setRightTab: (rightTab) => set({ rightTab }),
  notify: (toast) => {
    set({ toast });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 5000);
  },
  setWorkspaces: (patch) => {
    set(patch);
    const s = get();
    saveIndex({ version: 1, workspaces: s.workspaces, currentWorkspaceId: s.currentWorkspaceId, currentDocId: s.currentDocId });
  },
  switchDocument: (docId, workspaceId, diagram) => {
    flushSave();
    const s = get();
    histories.set(s.currentDocId, { past: s.past, future: s.future });
    const h = histories.get(docId) ?? { past: [], future: [] };
    set({
      diagram,
      past: h.past,
      future: h.future,
      selectedIds: [],
      editingId: null,
      cameraSuspended: false,
      tool: 'select',
      // Dans la même mise à jour que le diagramme : la sauvegarde auto ne doit jamais écrire
      // le nouveau contenu sous l'ancien identifiant
      currentDocId: docId,
      currentWorkspaceId: workspaceId,
    });
    get().setWorkspaces({});
  },

  pushHistory: () => {
    if (historyDelegate) historyDelegate.mark();
    else set((s) => ({ past: [...s.past, s.diagram].slice(-HISTORY_LIMIT), future: [] }));
  },
  apply: (fn) => set((s) => ({ diagram: fn(s.diagram) })),
  commit: (fn) => {
    get().pushHistory();
    get().apply(fn);
  },
  load: (d) => {
    get().pushHistory();
    set({ diagram: d, selectedIds: [], editingId: null, cameraSuspended: false });
  },
  undo: () =>
    historyDelegate ? historyDelegate.undo() : set((s) => {
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
    historyDelegate ? historyDelegate.redo() : set((s) => {
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

// Sauvegarde automatique du document courant (contenu + métadonnées dans l'index)
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: { docId: string; diagram: Diagram } | null = null;

/** Écrit immédiatement la sauvegarde en attente (avant de changer de document, d'exporter…). */
export function flushSave() {
  clearTimeout(saveTimer);
  if (!pending) return;
  const { docId, diagram } = pending;
  pending = null;
  const ok = saveDoc(docId, diagram);
  const s = useStore.getState();
  const workspaces = s.workspaces.map((w) => ({
    ...w,
    docs: w.docs.map((m) => (m.id === docId ? { ...m, ...docMeta(m.id, m.name, diagram) } : m)),
  }));
  useStore.setState({ storageFull: !ok });
  s.setWorkspaces({ workspaces });
}

useStore.subscribe((s, prev) => {
  if (s.diagram === prev.diagram || s.currentDocId !== prev.currentDocId) return;
  pending = { docId: s.currentDocId, diagram: s.diagram };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
});
window.addEventListener('beforeunload', flushSave);

/** Élément <svg> du canevas (pour pause/lecture et export). */
let svgElement: SVGSVGElement | null = null;
export const setCanvasSvg = (el: SVGSVGElement | null) => {
  svgElement = el;
};
export const getCanvasSvg = () => svgElement;
