import { autoSequence } from './animation';
import { fitViewport, leftInset } from './camera';
import { emptyDiagram, randomSeed, uid } from './defaults';
import { diagramBounds } from './geometry';
import { download, exportPngBlob, exportSvgString, FILE_EXTENSION, parseImportedText, pickFile, serializeDiagram } from './io/files';
import { mermaidToElements, type MermaidImportOptions } from './io/mermaid';
import { isSequenceDiagram, sequenceToElements, type SequenceImportOptions } from './io/mermaidSequence';
import { flushSave, getCanvasSvg, useStore } from './store';
import { fileSlug } from './workspace';
import { createDocument, currentDocName, importWorkspace } from './workspaceActions';
import type { Diagram, EdgeElement, NodeElement } from './types';

const st = () => useStore.getState();

export function deleteSelected() {
  const ids = new Set(st().selectedIds);
  if (!ids.size) return;
  st().commit((d) => ({
    ...d,
    nodes: d.nodes.filter((n) => !ids.has(n.id)),
    // Les liens rattachés à un nœud supprimé disparaissent aussi
    edges: d.edges.filter(
      (e) => !ids.has(e.id) && !(e.source.nodeId && ids.has(e.source.nodeId)) && !(e.target.nodeId && ids.has(e.target.nodeId)),
    ),
  }));
  st().select([]);
}

export function selectAll() {
  const d = st().diagram;
  st().select([...d.nodes.map((n) => n.id), ...d.edges.map((e) => e.id)]);
}

/** Ajoute des éléments en leur donnant de nouveaux identifiants (liens internes remappés). */
export function addElements(nodes: NodeElement[], edges: EdgeElement[], offset = { x: 0, y: 0 }) {
  const idMap = new Map<string, string>();
  const newNodes = nodes.map((n) => {
    const id = uid('n');
    idMap.set(n.id, id);
    return { ...n, id, seed: randomSeed(), x: n.x + offset.x, y: n.y + offset.y };
  });
  const existing = new Set(st().diagram.nodes.map((n) => n.id));
  const remapEnd = (end: EdgeElement['source']) => {
    const mapped = end.nodeId ? idMap.get(end.nodeId) : undefined;
    if (mapped) return { ...end, nodeId: mapped, x: end.x + offset.x, y: end.y + offset.y };
    if (end.nodeId && existing.has(end.nodeId)) return end;
    return { x: end.x + offset.x, y: end.y + offset.y };
  };
  const newEdges = edges.map((e) => ({ ...e, id: uid('e'), seed: randomSeed(), source: remapEnd(e.source), target: remapEnd(e.target) }));
  st().commit((d) => ({ ...d, nodes: [...d.nodes, ...newNodes], edges: [...d.edges, ...newEdges] }));
  st().select([...newNodes.map((n) => n.id), ...newEdges.map((e) => e.id)]);
}

function selectedElements() {
  const ids = new Set(st().selectedIds);
  const d = st().diagram;
  return { nodes: d.nodes.filter((n) => ids.has(n.id)), edges: d.edges.filter((e) => ids.has(e.id)) };
}

export function duplicateSelected() {
  const { nodes, edges } = selectedElements();
  if (nodes.length || edges.length) addElements(nodes, edges, { x: 24, y: 24 });
}

export const CLIPBOARD_TYPE = 'animflow/clipboard';

export function clipboardPayload(): string | null {
  const { nodes, edges } = selectedElements();
  if (!nodes.length && !edges.length) return null;
  return JSON.stringify({ type: CLIPBOARD_TYPE, nodes, edges });
}

/** Colle du texte : éléments AnimFlow copiés, diagramme JSON complet ou Mermaid. Renvoie false si non reconnu. */
export function pasteText(text: string): boolean {
  try {
    const data = JSON.parse(text);
    if (data?.type === CLIPBOARD_TYPE) {
      addElements(data.nodes, data.edges, { x: 24, y: 24 });
      return true;
    }
  } catch {
    // pas du JSON : on essaie les autres formats
  }
  try {
    const parsed = parseImportedText(text);
    if (parsed.kind === 'diagram') addElements(parsed.diagram.nodes, parsed.diagram.edges);
    else if (parsed.kind === 'workspace') importWorkspace(parsed.file);
    else importMermaid(parsed.source, 'add');
    return true;
  } catch {
    return false;
  }
}

export function nudgeSelected(dx: number, dy: number) {
  const ids = new Set(st().selectedIds);
  if (!ids.size) return;
  st().commit((d) => ({
    ...d,
    nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
    edges: d.edges.map((e) =>
      ids.has(e.id)
        ? {
            ...e,
            source: e.source.nodeId ? e.source : { x: e.source.x + dx, y: e.source.y + dy },
            target: e.target.nodeId ? e.target : { x: e.target.x + dx, y: e.target.y + dy },
          }
        : e,
    ),
  }));
}

/** « Nouveau » : nouveau document vide dans le workspace courant. */
export function newDiagram() {
  createDocument();
}

/** Où placer un contenu importé : remplacer le document, l'ajouter au document, ou créer un nouveau document. */
export type ImportMode = 'replace' | 'add' | 'new';

export function applyAutoSequence() {
  st().commit((d) => autoSequence(d));
}

/** Point d'insertion : sous le contenu existant, sinon au centre de la vue. */
function insertionOrigin(): { x: number; y: number } {
  const b = diagramBounds(st().diagram);
  if (b) return { x: b.minX, y: b.maxY + 80 };
  const vp = st().viewport;
  return { x: (80 - vp.x) / vp.zoom, y: (120 - vp.y) / vp.zoom };
}

export function importMermaid(source: string, mode: ImportMode, opts: Partial<MermaidImportOptions> = {}, docName = 'Import Mermaid') {
  const options: MermaidImportOptions = {
    animation: 'flow',
    roughness: 1,
    routing: 'straight',
    origin: mode === 'add' ? insertionOrigin() : { x: 80, y: 80 },
    ...opts,
  };
  if (isSequenceDiagram(source)) {
    importSequence(source, mode, { roughness: options.roughness, origin: options.origin }, docName);
    return;
  }
  const { nodes, edges } = mermaidToElements(source, options);
  insertImported(nodes, edges, mode, {}, docName);
}

/** Diagramme de séquence Mermaid : rendu « séquence animée » (par défaut) ou « schéma en boîtes ». */
export function importSequence(source: string, mode: ImportMode, opts: Partial<SequenceImportOptions> = {}, docName = 'Diagramme de séquence') {
  const render = opts.render ?? 'sequence';
  const { nodes, edges, settings } = sequenceToElements(source, {
    render,
    animation: render === 'sequence' ? 'draw' : 'particles',
    roughness: 1,
    reveal: render === 'sequence',
    origin: mode === 'add' ? insertionOrigin() : { x: 80, y: 80 },
    pause: st().diagram.settings.stepPause,
    ...opts,
  });
  insertImported(nodes, edges, mode, settings, docName);
}

function insertImported(
  nodes: NodeElement[],
  edges: EdgeElement[],
  mode: ImportMode,
  settings: Partial<Diagram['settings']> = {},
  docName = 'Import',
) {
  if (mode === 'new') {
    createDocument(docName, { ...emptyDiagram(), settings: { ...emptyDiagram().settings, ...settings }, nodes, edges });
  } else if (mode === 'replace') {
    st().load({ ...emptyDiagram(), settings: { ...st().diagram.settings, ...settings }, nodes, edges });
  } else {
    addElements(nodes, edges);
    if (Object.keys(settings).length) st().apply((d) => ({ ...d, settings: { ...d.settings, ...settings } }));
  }
  requestAnimationFrame(() => zoomToFit());
}

export function zoomToFit() {
  const b = diagramBounds(st().diagram);
  const svg = getCanvasSvg();
  if (!b || !svg) return;
  st().setViewport(fitViewport(b, svg.getBoundingClientRect(), 1.5, leftInset(st().sidebarOpen)));
}

export function saveJson() {
  download(`${fileSlug(currentDocName())}${FILE_EXTENSION}`, serializeDiagram(st().diagram), 'application/json');
}

export function exportSvg() {
  const svg = getCanvasSvg();
  if (!svg) return;
  download(`${fileSlug(currentDocName())}.svg`, exportSvgString(st().diagram, svg), 'image/svg+xml');
}

export async function exportPng() {
  const svg = getCanvasSvg();
  if (!svg) return;
  download(`${fileSlug(currentDocName())}.png`, await exportPngBlob(exportSvgString(st().diagram, svg)));
}

/** Importe un fichier : par défaut dans un nouveau document nommé d'après le fichier. */
export async function importFile(file: File, mode: ImportMode = 'new') {
  try {
    flushSave();
    const parsed = parseImportedText(await file.text());
    const name = file.name.replace(/(\.animflow)?\.(json|svg|mmd|mermaid|txt|md)$/i, '').replace(/\.animflow-workspace$/i, '') || 'Import';
    if (parsed.kind === 'workspace') importWorkspace(parsed.file);
    else if (parsed.kind === 'mermaid') importMermaid(parsed.source, mode, {}, name);
    else if (mode === 'add') addElements(parsed.diagram.nodes, parsed.diagram.edges);
    else {
      if (mode === 'new') createDocument(name, parsed.diagram);
      else st().load(parsed.diagram);
      requestAnimationFrame(() => zoomToFit());
    }
  } catch (err) {
    alert(`Import impossible : ${(err as Error).message}`);
  }
}

export async function openFile() {
  const file = await pickFile('.json,.svg,.mmd,.mermaid,.txt,.md');
  if (file) await importFile(file);
}
