import { startSession, stopSession } from './collab';
import { emptyDiagram, uid } from './defaults';
import { download } from './io/files';
import { flushSave, useStore } from './store';
import type { Diagram } from './types';
import {
  docMeta,
  fileSlug,
  loadDoc,
  removeDoc,
  saveDoc,
  WORKSPACE_FILE_TYPE,
  type Workspace,
  type WorkspaceFile,
} from './workspace';

const st = () => useStore.getState();

export const currentWorkspace = (): Workspace => {
  const s = st();
  return s.workspaces.find((w) => w.id === s.currentWorkspaceId) ?? s.workspaces[0];
};

export const currentDocName = () => currentWorkspace().docs.find((m) => m.id === st().currentDocId)?.name ?? 'Sans titre';

const findDoc = (docId: string) => {
  for (const w of st().workspaces) {
    const meta = w.docs.find((m) => m.id === docId);
    if (meta) return { workspace: w, meta };
  }
  return null;
};

const mapWorkspace = (id: string, fn: (w: Workspace) => Workspace) => st().workspaces.map((w) => (w.id === id ? fn(w) : w));

/** Nom unique dans le workspace : « Sans titre », « Sans titre 2 »… */
function uniqueName(workspace: Workspace, base: string) {
  const names = new Set(workspace.docs.map((m) => m.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function openDocument(docId: string) {
  if (docId === st().currentDocId) return;
  const found = findDoc(docId);
  if (!found) return;
  flushSave();
  const diagram = loadDoc(docId);
  if (!diagram) {
    alert('Ce document est introuvable dans le stockage du navigateur.');
    return;
  }
  st().switchDocument(docId, found.workspace.id, diagram);
}

/** Crée un document (vide par défaut) dans un workspace et l'ouvre. */
export function createDocument(name = 'Sans titre', diagram: Diagram = emptyDiagram(), workspaceId = st().currentWorkspaceId) {
  flushSave();
  const ws = st().workspaces.find((w) => w.id === workspaceId) ?? currentWorkspace();
  const meta = docMeta(uid('d'), uniqueName(ws, name), diagram);
  if (!saveDoc(meta.id, diagram)) {
    alert('Le stockage du navigateur est plein : supprimez des documents ou exportez votre workspace.');
    return;
  }
  st().setWorkspaces({ workspaces: mapWorkspace(ws.id, (w) => ({ ...w, docs: [...w.docs, meta] })) });
  st().switchDocument(meta.id, ws.id, diagram);
}

export function renameDocument(docId: string, name: string) {
  const found = findDoc(docId);
  const clean = name.trim();
  if (!found || !clean) return;
  st().setWorkspaces({
    workspaces: mapWorkspace(found.workspace.id, (w) => ({ ...w, docs: w.docs.map((m) => (m.id === docId ? { ...m, name: clean } : m)) })),
  });
}

export function duplicateDocument(docId: string) {
  flushSave();
  const found = findDoc(docId);
  const diagram = loadDoc(docId);
  if (found && diagram) createDocument(`${found.meta.name} (copie)`, diagram, found.workspace.id);
}

export function deleteDocument(docId: string) {
  const found = findDoc(docId);
  if (!found) return;
  flushSave();
  const remaining = found.workspace.docs.filter((m) => m.id !== docId);
  if (docId === st().currentDocId) {
    // On ouvre le document le plus récent restant, ou un nouveau document vide
    const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (next) openDocument(next.id);
    else createDocument('Sans titre', emptyDiagram(), found.workspace.id);
  }
  st().setWorkspaces({ workspaces: mapWorkspace(found.workspace.id, (w) => ({ ...w, docs: w.docs.filter((m) => m.id !== docId) })) });
  removeDoc(docId);
}

export function moveDocument(docId: string, workspaceId: string) {
  const found = findDoc(docId);
  if (!found || found.workspace.id === workspaceId) return;
  const target = st().workspaces.find((w) => w.id === workspaceId);
  if (!target) return;
  const meta = { ...found.meta, name: uniqueName(target, found.meta.name) };
  st().setWorkspaces({
    workspaces: st().workspaces.map((w) =>
      w.id === found.workspace.id ? { ...w, docs: w.docs.filter((m) => m.id !== docId) } : w.id === workspaceId ? { ...w, docs: [...w.docs, meta] } : w,
    ),
    // Le document ouvert suit son workspace
    ...(docId === st().currentDocId ? { currentWorkspaceId: workspaceId } : {}),
  });
}

export function switchWorkspace(workspaceId: string) {
  const ws = st().workspaces.find((w) => w.id === workspaceId);
  if (!ws || ws.id === st().currentWorkspaceId) return;
  const recent = [...ws.docs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (recent) openDocument(recent.id);
  else createDocument('Sans titre', emptyDiagram(), ws.id);
}

export function createWorkspace(name: string) {
  const clean = name.trim();
  if (!clean) return;
  const ws: Workspace = { id: uid('w'), name: clean, docs: [] };
  st().setWorkspaces({ workspaces: [...st().workspaces, ws] });
  createDocument('Sans titre', emptyDiagram(), ws.id);
}

export function renameWorkspace(workspaceId: string, name: string) {
  const clean = name.trim();
  if (clean) st().setWorkspaces({ workspaces: mapWorkspace(workspaceId, (w) => ({ ...w, name: clean })) });
}

/** Supprime un workspace et ses documents (il en reste toujours au moins un). */
export function deleteWorkspace(workspaceId: string) {
  const all = st().workspaces;
  const ws = all.find((w) => w.id === workspaceId);
  if (!ws || all.length < 2) return;
  if (workspaceId === st().currentWorkspaceId) switchWorkspace(all.find((w) => w.id !== workspaceId)!.id);
  st().setWorkspaces({ workspaces: st().workspaces.filter((w) => w.id !== workspaceId) });
  ws.docs.forEach((m) => removeDoc(m.id));
}

export function exportWorkspace(workspaceId = st().currentWorkspaceId) {
  flushSave();
  const ws = st().workspaces.find((w) => w.id === workspaceId);
  if (!ws) return;
  const file: WorkspaceFile = {
    type: WORKSPACE_FILE_TYPE,
    version: 1,
    name: ws.name,
    documents: ws.docs.flatMap((m) => {
      const diagram = loadDoc(m.id);
      return diagram ? [{ name: m.name, diagram }] : [];
    }),
  };
  download(`${fileSlug(ws.name)}.animflow-workspace.json`, JSON.stringify(file, null, 2), 'application/json');
}

/** Importe un fichier workspace comme nouveau workspace, et ouvre son premier document. */
export function importWorkspace(file: WorkspaceFile) {
  flushSave();
  const names = new Set(st().workspaces.map((w) => w.name));
  let name = file.name || 'Workspace importé';
  if (names.has(name)) name = `${name} (importé)`;
  const ws: Workspace = { id: uid('w'), name, docs: [] };
  for (const doc of file.documents) {
    const meta = docMeta(uid('d'), uniqueName(ws, doc.name || 'Sans titre'), doc.diagram);
    if (!saveDoc(meta.id, doc.diagram)) {
      alert('Le stockage du navigateur est plein : import partiel.');
      break;
    }
    ws.docs.push(meta);
  }
  st().setWorkspaces({ workspaces: [...st().workspaces, ws] });
  if (ws.docs.length) openDocument(ws.docs[0].id);
  else createDocument('Sans titre', emptyDiagram(), ws.id);
}

/** Associe (ou dissocie) une salle de collaboration à un document. */
export function setDocRoom(docId: string, room: string | undefined) {
  const found = findDoc(docId);
  if (!found) return;
  st().setWorkspaces({
    workspaces: mapWorkspace(found.workspace.id, (w) => ({ ...w, docs: w.docs.map((m) => (m.id === docId ? { ...m, room } : m)) })),
  });
}

/** Partage le document ouvert dans une nouvelle salle (ou sa salle habituelle). */
export function shareCurrentDocument(room: string) {
  setDocRoom(st().currentDocId, room);
  history.replaceState(null, '', `#room=${room}`);
  startSession(room);
}

/** Rejoint une salle depuis un lien : rouvre le document déjà associé, sinon crée « Session partagée ». */
export function joinRoom(room: string) {
  if (st().collab?.room === room) return;
  stopSession();
  let existing: string | undefined;
  for (const w of st().workspaces) existing ??= w.docs.find((m) => m.room === room)?.id;
  if (existing) openDocument(existing);
  else {
    createDocument('Session partagée');
    setDocRoom(st().currentDocId, room);
  }
  startSession(room);
}
