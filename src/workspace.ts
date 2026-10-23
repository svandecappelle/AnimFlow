/**
 * Stockage des workspaces et documents dans le navigateur (localStorage).
 *
 *  - `animflow:workspaces` : index (workspaces, métadonnées des documents, document ouvert) ;
 *  - `animflow:doc:<id>`   : contenu d'un document (diagramme JSON).
 *
 * Un document = un schéma. Un workspace = un ensemble nommé de documents (comme les collections d'Excalidraw+).
 */
import { normalizeDiagram, uid } from './defaults';
import type { Diagram } from './types';

export interface DocMeta {
  id: string;
  name: string;
  updatedAt: number;
  nodes: number;
  edges: number;
  /** Salle de collaboration associée (rejoindre le même lien rouvre ce document) */
  room?: string;
}

export interface Workspace {
  id: string;
  name: string;
  docs: DocMeta[];
}

export interface WorkspaceIndex {
  version: 1;
  workspaces: Workspace[];
  currentWorkspaceId: string;
  currentDocId: string;
}

const INDEX_KEY = 'animflow:workspaces';
const LEGACY_KEY = 'animflow:diagram';
const docKey = (id: string) => `animflow:doc:${id}`;

export const WORKSPACE_FILE_TYPE = 'animflow/workspace';

export function docMeta(id: string, name: string, d: Diagram): DocMeta {
  return { id, name, updatedAt: Date.now(), nodes: d.nodes.length, edges: d.edges.length };
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Écrit une valeur ; renvoie false si le stockage est plein ou indisponible. */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadDoc(id: string): Diagram | null {
  const raw = read<unknown>(docKey(id));
  if (!raw) return null;
  try {
    return normalizeDiagram(raw);
  } catch {
    return null;
  }
}

export const saveDoc = (id: string, d: Diagram) => write(docKey(id), d);
export const saveIndex = (index: WorkspaceIndex) => write(INDEX_KEY, index);

export function removeDoc(id: string) {
  try {
    localStorage.removeItem(docKey(id));
  } catch {
    // stockage indisponible : rien à nettoyer
  }
}

/**
 * Charge l'index (en le réparant si besoin). Au premier lancement, ou depuis une version sans workspaces,
 * crée le workspace « Personnel » avec le schéma existant ou `firstDiagram`.
 */
export function loadIndex(firstDiagram: () => Diagram): { index: WorkspaceIndex; diagram: Diagram } {
  const index = read<WorkspaceIndex>(INDEX_KEY);
  if (index?.workspaces?.length) {
    // Réparation : documents dont le contenu a disparu, document courant introuvable
    for (const ws of index.workspaces) ws.docs = (ws.docs ?? []).filter((m) => localStorage.getItem(docKey(m.id)) !== null);
    const ws = index.workspaces.find((w) => w.id === index.currentWorkspaceId) ?? index.workspaces[0];
    let meta = ws.docs.find((m) => m.id === index.currentDocId) ?? [...ws.docs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    let diagram = meta ? loadDoc(meta.id) : null;
    if (!meta || !diagram) {
      diagram = firstDiagram();
      meta = docMeta(uid('d'), 'Sans titre', diagram);
      ws.docs.push(meta);
      saveDoc(meta.id, diagram);
    }
    const fixed: WorkspaceIndex = { ...index, currentWorkspaceId: ws.id, currentDocId: meta.id };
    saveIndex(fixed);
    return { index: fixed, diagram };
  }

  // Migration depuis la version mono-document, ou premier lancement
  let diagram: Diagram;
  let name = 'Mon schéma';
  const legacy = read<unknown>(LEGACY_KEY);
  try {
    diagram = legacy ? normalizeDiagram(legacy) : firstDiagram();
  } catch {
    diagram = firstDiagram();
  }
  if (!legacy) name = 'Exemple';
  const meta = docMeta(uid('d'), name, diagram);
  const created: WorkspaceIndex = {
    version: 1,
    workspaces: [{ id: uid('w'), name: 'Personnel', docs: [meta] }],
    currentWorkspaceId: '',
    currentDocId: meta.id,
  };
  created.currentWorkspaceId = created.workspaces[0].id;
  saveDoc(meta.id, diagram);
  saveIndex(created);
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // sans importance
  }
  return { index: created, diagram };
}

export interface WorkspaceFile {
  type: typeof WORKSPACE_FILE_TYPE;
  version: 1;
  name: string;
  documents: { name: string; diagram: Diagram }[];
}

export function isWorkspaceFile(raw: unknown): raw is WorkspaceFile {
  return typeof raw === 'object' && raw !== null && (raw as WorkspaceFile).type === WORKSPACE_FILE_TYPE;
}

/** Nom de fichier sûr à partir d'un nom de document ou de workspace. */
export const fileSlug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'schema';
