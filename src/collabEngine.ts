/**
 * Moteur de collaboration (chargé à la demande) : réplication du schéma dans un document Yjs via le relais
 * y-websocket. Voir collab.ts pour la vue d'ensemble.
 */
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { collabUrl, type User } from './collab';
import { setHistoryDelegate, useStore, type Peer } from './store';
import type { Diagram, DiagramSettings, EdgeElement, NodeElement } from './types';

const ORIGIN = 'animflow-local';

type Element = NodeElement | EdgeElement;
type Stored<T extends Element> = T & { _i: number };

interface Session {
  room: string;
  docId: string;
  doc: Y.Doc;
  provider: WebsocketProvider;
  nodes: Y.Map<Stored<NodeElement>>;
  edges: Y.Map<Stored<EdgeElement>>;
  settings: Y.Map<unknown>;
  undo: Y.UndoManager;
  /** Dernière version du diagramme connue du document Yjs */
  synced: Diagram | null;
  dispose: () => void;
}

let session: Session | null = null;
let applyingRemote = false;

/** Retire le rang `_i` (avec cache : un même objet Yjs donne toujours le même élément, sans re-rendu). */
const stripCache = new WeakMap<object, Element>();
function strip<T extends Element>(stored: Stored<T>): T {
  let el = stripCache.get(stored) as T | undefined;
  if (!el) {
    const { _i, ...rest } = stored;
    void _i;
    el = rest as unknown as T;
    stripCache.set(stored, el);
  }
  return el;
}

function readList<T extends Element>(map: Y.Map<Stored<T>>): T[] {
  return [...map.values()].sort((a, b) => a._i - b._i || (a.id < b.id ? -1 : 1)).map((s) => strip(s));
}

/** Envoie les éléments ajoutés / modifiés / supprimés entre deux versions du diagramme. */
function writeList<T extends Element>(map: Y.Map<Stored<T>>, prev: T[] | undefined, next: T[]) {
  const before = new Map((prev ?? []).map((e) => [e.id, e]));
  let maxRank = Math.max(0, ...[...map.values()].map((s) => s._i));
  for (const el of next) {
    const old = before.get(el.id);
    before.delete(el.id);
    if (old === el) continue;
    const existing = map.get(el.id);
    if (existing && strip(existing) === el) continue; // déjà à jour (élément venu du distant)
    map.set(el.id, { ...el, _i: existing?._i ?? ++maxRank });
  }
  for (const id of before.keys()) map.delete(id);
}

function pushLocal(s: Session, prev: Diagram | null, next: Diagram) {
  s.doc.transact(() => {
    writeList(s.nodes, prev?.nodes, next.nodes);
    writeList(s.edges, prev?.edges, next.edges);
    for (const [k, v] of Object.entries(next.settings)) {
      if (!prev || prev.settings[k as keyof DiagramSettings] !== v) s.settings.set(k, v);
    }
  }, ORIGIN);
  s.synced = next;
}

function applyRemote(s: Session) {
  const current = useStore.getState().diagram;
  const next: Diagram = {
    ...current,
    nodes: readList(s.nodes),
    edges: readList(s.edges),
    settings: { ...current.settings, ...(s.settings.toJSON() as Partial<DiagramSettings>) },
  };
  applyingRemote = true;
  try {
    useStore.getState().apply(() => next);
  } finally {
    applyingRemote = false;
  }
  s.synced = next;
  // Les éléments sélectionnés supprimés par quelqu'un d'autre sortent de la sélection
  const ids = new Set([...next.nodes.map((n) => n.id), ...next.edges.map((e) => e.id)]);
  const sel = useStore.getState().selectedIds;
  if (sel.some((id) => !ids.has(id))) useStore.getState().select(sel.filter((id) => ids.has(id)));
}

/** Démarre la synchronisation ; `onDocumentChange` est appelé si l'utilisateur ouvre un autre document. */
export function start(room: string, user: User, onDocumentChange: () => void) {
  stop();
  const store = useStore.getState();
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(collabUrl(), room, doc);
  const nodes = doc.getMap<Stored<NodeElement>>('nodes');
  const edges = doc.getMap<Stored<EdgeElement>>('edges');
  const settings = doc.getMap<unknown>('settings');
  const undo = new Y.UndoManager([nodes, edges, settings], { trackedOrigins: new Set([ORIGIN]), captureTimeout: Number.MAX_SAFE_INTEGER });
  const s: Session = { room, docId: store.currentDocId, doc, provider, nodes, edges, settings, undo, synced: null, dispose: () => {} };
  session = s;

  let initialized = false;
  provider.on('sync', (isSynced: boolean) => {
    if (!isSynced || initialized) return;
    initialized = true;
    if (nodes.size === 0 && edges.size === 0 && settings.size === 0) pushLocal(s, null, useStore.getState().diagram);
    else applyRemote(s);
    undo.clear();
  });
  provider.on('status', ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) => useStore.getState().setCollab({ status }));

  doc.on('afterTransaction', (tr: Y.Transaction) => {
    if (initialized && tr.origin !== ORIGIN && tr.changed.size) applyRemote(s);
  });

  const refreshUndo = () => useStore.getState().setCollab({ canUndo: undo.canUndo(), canRedo: undo.canRedo() });
  undo.on('stack-item-added', refreshUndo);
  undo.on('stack-item-popped', refreshUndo);
  undo.on('stack-cleared', refreshUndo);
  setHistoryDelegate({ mark: () => undo.stopCapturing(), undo: () => undo.undo(), redo: () => undo.redo() });

  // Présence
  const awareness = provider.awareness;
  awareness.setLocalState({ user, cursor: null, selection: store.selectedIds });
  const onAwareness = () => {
    const peers: Peer[] = [];
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === doc.clientID || !state.user) return;
      peers.push({ clientId, name: state.user.name, color: state.user.color, cursor: state.cursor ?? null, selection: state.selection ?? [] });
    });
    useStore.getState().setPeers(peers);
  };
  awareness.on('change', onAwareness);

  const unsubscribe = useStore.subscribe((st, prev) => {
    if (session !== s) return;
    if (st.currentDocId !== s.docId) {
      // Changer de document met fin à la session (le document partagé reste dans le workspace)
      onDocumentChange();
      return;
    }
    if (st.selectedIds !== prev.selectedIds) awareness.setLocalStateField('selection', st.selectedIds);
    if (initialized && !applyingRemote && st.diagram !== prev.diagram) pushLocal(s, s.synced, st.diagram);
  });

  s.dispose = () => {
    unsubscribe();
    awareness.off('change', onAwareness);
    provider.destroy();
    doc.destroy();
  };
}

export function stop() {
  if (!session) return;
  const s = session;
  session = null;
  setHistoryDelegate(null);
  s.dispose();
}

export function setUser(user: User) {
  session?.provider.awareness.setLocalStateField('user', user);
}

let cursorFrame = 0;
let pendingCursor: { x: number; y: number } | null = null;
export function updateCursor(p: { x: number; y: number } | null) {
  if (!session) return;
  pendingCursor = p;
  if (cursorFrame) return;
  cursorFrame = requestAnimationFrame(() => {
    cursorFrame = 0;
    session?.provider.awareness.setLocalStateField('cursor', pendingCursor);
  });
}
