import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode, emptyDiagram } from './defaults';
import { parseImportedText } from './io/files';
import { WORKSPACE_FILE_TYPE } from './workspace';

/** Charge un store neuf (le store lit le stockage à l'import). */
async function fresh() {
  vi.resetModules();
  const store = await import('./store');
  const actions = await import('./workspaceActions');
  const ws = await import('./workspace');
  return { ...store, ...actions, ...ws, st: () => store.useStore.getState() };
}

const withNode = (label: string) => ({ ...emptyDiagram(), nodes: [createNode('rectangle', 0, 0, 100, 50, { label })] });

beforeEach(() => localStorage.clear());

describe('workspaces et documents', () => {
  it('migre le schéma de la version mono-document dans le workspace « Personnel »', async () => {
    localStorage.setItem('animflow:diagram', JSON.stringify(withNode('ancien')));
    const { st } = await fresh();
    expect(st().workspaces).toHaveLength(1);
    expect(st().workspaces[0].name).toBe('Personnel');
    expect(st().workspaces[0].docs[0].name).toBe('Mon schéma');
    expect(st().diagram.nodes[0].label).toBe('ancien');
    expect(localStorage.getItem('animflow:diagram')).toBeNull();
  });

  it('premier lancement : un document « Exemple »', async () => {
    const { st } = await fresh();
    expect(st().workspaces[0].docs[0].name).toBe('Exemple');
    expect(st().diagram.nodes.length).toBeGreaterThan(0);
  });

  it('la sauvegarde en attente va dans le bon document lors d’un changement', async () => {
    const { st, createDocument, openDocument, loadDoc } = await fresh();
    const first = st().currentDocId;
    st().commit((d) => ({ ...d, nodes: [...d.nodes, createNode('ellipse', 0, 0, 10, 10, { label: 'modif-1' })] }));
    // changement immédiat, avant la fin du délai de sauvegarde
    createDocument('Deuxième', withNode('doc-2'));
    const second = st().currentDocId;
    expect(second).not.toBe(first);
    expect(loadDoc(first)!.nodes.some((n) => n.label === 'modif-1')).toBe(true);
    expect(loadDoc(second)!.nodes.map((n) => n.label)).toEqual(['doc-2']);
    openDocument(first);
    expect(st().diagram.nodes.some((n) => n.label === 'modif-1')).toBe(true);
  });

  it('chaque document garde son historique d’annulation', async () => {
    const { st, createDocument, openDocument } = await fresh();
    const first = st().currentDocId;
    st().commit((d) => ({ ...d, nodes: [] }));
    createDocument('Autre');
    expect(st().past).toHaveLength(0);
    openDocument(first);
    expect(st().past).toHaveLength(1);
    st().undo();
    expect(st().diagram.nodes.length).toBeGreaterThan(0);
  });

  it('noms uniques, renommage, duplication, suppression du document ouvert', async () => {
    const { st, createDocument, renameDocument, duplicateDocument, deleteDocument, loadDoc } = await fresh();
    createDocument();
    createDocument();
    const names = () => st().workspaces[0].docs.map((m) => m.name);
    expect(names()).toEqual(['Exemple', 'Sans titre', 'Sans titre 2']);
    const id = st().currentDocId;
    renameDocument(id, '  Architecture  ');
    expect(names()).toContain('Architecture');
    duplicateDocument(id);
    expect(names()).toContain('Architecture (copie)');
    const copy = st().currentDocId;
    deleteDocument(copy);
    expect(names()).not.toContain('Architecture (copie)');
    expect(loadDoc(copy)).toBeNull();
    expect(st().currentDocId).not.toBe(copy);
  });

  it('workspaces : création, déplacement de document, suppression', async () => {
    const { st, createWorkspace, moveDocument, deleteWorkspace, switchWorkspace } = await fresh();
    const personal = st().currentWorkspaceId;
    const exampleId = st().currentDocId;
    createWorkspace('Projet X');
    const projet = st().currentWorkspaceId;
    expect(projet).not.toBe(personal);
    expect(st().workspaces.find((w) => w.id === projet)!.docs).toHaveLength(1);
    moveDocument(exampleId, projet);
    expect(st().workspaces.find((w) => w.id === personal)!.docs).toHaveLength(0);
    expect(st().workspaces.find((w) => w.id === projet)!.docs).toHaveLength(2);
    // un workspace vide reçoit un document à l'ouverture
    switchWorkspace(personal);
    expect(st().workspaces.find((w) => w.id === personal)!.docs).toHaveLength(1);
    deleteWorkspace(projet);
    expect(st().workspaces.map((w) => w.id)).toEqual([personal]);
    expect(localStorage.getItem(`animflow:doc:${exampleId}`)).toBeNull();
    deleteWorkspace(personal); // le dernier workspace est conservé
    expect(st().workspaces).toHaveLength(1);
  });

  it('import d’un fichier workspace', async () => {
    const { st, importWorkspace } = await fresh();
    const text = JSON.stringify({
      type: WORKSPACE_FILE_TYPE,
      version: 1,
      name: 'Équipe',
      documents: [
        { name: 'A', diagram: withNode('a') },
        { name: 'B', diagram: { nodes: [], edges: [] } },
      ],
    });
    const parsed = parseImportedText(text);
    expect(parsed.kind).toBe('workspace');
    if (parsed.kind !== 'workspace') return;
    importWorkspace(parsed.file);
    const ws = st().workspaces.find((w) => w.name === 'Équipe')!;
    expect(ws.docs.map((m) => m.name)).toEqual(['A', 'B']);
    expect(st().currentWorkspaceId).toBe(ws.id);
    expect(st().diagram.nodes[0].label).toBe('a');
  });

  it('l’index survit à un rechargement et pointe sur le dernier document ouvert', async () => {
    const a = await fresh();
    a.createDocument('Persisté', withNode('p'));
    a.flushSave();
    const b = await fresh();
    expect(b.st().diagram.nodes[0].label).toBe('p');
    expect(b.st().workspaces[0].docs.map((m) => m.name)).toContain('Persisté');
  });
});
