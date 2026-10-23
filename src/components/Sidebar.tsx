import { useEffect, useRef, useState } from 'react';
import { openFile } from '../actions';
import { useStore } from '../store';
import { plural } from '../text';
import type { DocMeta } from '../workspace';
import {
  createDocument,
  createWorkspace,
  deleteDocument,
  deleteWorkspace,
  duplicateDocument,
  exportWorkspace,
  moveDocument,
  openDocument,
  renameDocument,
  renameWorkspace,
  switchWorkspace,
} from '../workspaceActions';
import { icons } from './icons';

function relativeDate(ts: number) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'à l’instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `il y a ${Math.floor(diff / 86400)} j`;
  return new Date(ts).toLocaleDateString('fr-FR');
}

/** Champ de saisie en place (renommage) : Entrée valide, Échap annule. */
function InlineInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="inline-input"
      defaultValue={value}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone((e.target as HTMLInputElement).value);
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

function DocItem({ meta, active, onMenu }: { meta: DocMeta; active: boolean; onMenu: (m: DocMeta, x: number, y: number) => void }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      className={`doc-item ${active ? 'active' : ''}`}
      onClick={() => openDocument(meta.id)}
      onDoubleClick={() => setRenaming(true)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(meta, e.clientX, e.clientY);
      }}
      title="Clic : ouvrir — double-clic : renommer — clic droit : actions"
    >
      <div className="doc-main">
        {renaming ? (
          <InlineInput
            value={meta.name}
            onDone={(v) => {
              if (v !== null) renameDocument(meta.id, v);
              setRenaming(false);
            }}
          />
        ) : (
          <span className="doc-name">{meta.name}</span>
        )}
        <span className="doc-sub">
          {relativeDate(meta.updatedAt)} · {plural(meta.nodes, 'forme')} · {plural(meta.edges, 'lien')}
        </span>
      </div>
      <button
        className="icon-btn small"
        title="Actions"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(meta, r.right, r.bottom);
        }}
      >
        ⋯
      </button>
    </div>
  );
}

export function Sidebar() {
  const workspaces = useStore((s) => s.workspaces);
  const currentWorkspaceId = useStore((s) => s.currentWorkspaceId);
  const currentDocId = useStore((s) => s.currentDocId);
  const storageFull = useStore((s) => s.storageFull);
  const ws = workspaces.find((w) => w.id === currentWorkspaceId) ?? workspaces[0];
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ meta: DocMeta; x: number; y: number } | null>(null);
  const [renamingWs, setRenamingWs] = useState(false);
  const [wsMenu, setWsMenu] = useState(false);

  useEffect(() => {
    if (!menu && !wsMenu) return;
    const close = () => {
      setMenu(null);
      setWsMenu(false);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu, wsMenu]);

  const q = query.trim().toLowerCase();
  // Plus récents d'abord ; à égalité, le dernier créé (fin de liste) en premier
  const docs = ws.docs
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !q || m.name.toLowerCase().includes(q))
    .sort((a, b) => b.m.updatedAt - a.m.updatedAt || b.i - a.i)
    .map(({ m }) => m);

  return (
    <aside className="sidebar panel">
      <div className="ws-header">
        {renamingWs ? (
          <InlineInput
            value={ws.name}
            onDone={(v) => {
              if (v !== null) renameWorkspace(ws.id, v);
              setRenamingWs(false);
            }}
          />
        ) : (
          <select className="ws-select" value={ws.id} onChange={(e) => (e.target.value === '__new' ? newWorkspace() : switchWorkspace(e.target.value))}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.docs.length})
              </option>
            ))}
            <option value="__new">＋ Nouveau workspace…</option>
          </select>
        )}
        <button
          className="icon-btn small"
          title="Actions du workspace"
          onClick={(e) => {
            e.stopPropagation();
            setWsMenu(!wsMenu);
          }}
        >
          ⋯
        </button>
        {wsMenu && (
          <div className="menu-list panel ws-menu" onClick={(e) => e.stopPropagation()}>
            <button className="menu-item" onClick={() => (setWsMenu(false), setRenamingWs(true))}>
              Renommer le workspace
            </button>
            <button className="menu-item" onClick={() => (setWsMenu(false), newWorkspace())}>
              Nouveau workspace…
            </button>
            <button className="menu-item" onClick={() => (setWsMenu(false), exportWorkspace(ws.id))}>
              Exporter le workspace (.json)
            </button>
            <button className="menu-item" onClick={() => (setWsMenu(false), void openFile())}>
              Importer un workspace ou un document…
            </button>
            <button
              className="menu-item danger"
              disabled={workspaces.length < 2}
              title={workspaces.length < 2 ? 'Il faut garder au moins un workspace' : undefined}
              onClick={() => {
                setWsMenu(false);
                if (confirm(`Supprimer le workspace « ${ws.name} » et ses ${ws.docs.length} document(s) ? Cette action est définitive.`))
                  deleteWorkspace(ws.id);
              }}
            >
              Supprimer le workspace
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-tools">
        <input className="search" placeholder="Rechercher un document…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn primary small" title="Nouveau document" onClick={() => createDocument()}>
          ＋ Nouveau
        </button>
      </div>

      <div className="doc-list">
        {docs.map((m) => (
          <DocItem key={m.id} meta={m} active={m.id === currentDocId} onMenu={(meta, x, y) => setMenu({ meta, x, y })} />
        ))}
        {!docs.length && <p className="muted center">{q ? 'Aucun document ne correspond.' : 'Aucun document.'}</p>}
      </div>

      {storageFull && (
        <p className="error small-print">
          Stockage du navigateur plein : la dernière modification n’a pas été sauvegardée. Exportez puis supprimez des documents.
        </p>
      )}
      <p className="muted small-print">Les documents sont enregistrés dans ce navigateur. Exportez un workspace pour le sauvegarder ou le partager.</p>

      {menu && (
        <div className="menu-list panel doc-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button className="menu-item" onClick={() => (setMenu(null), openDocument(menu.meta.id))}>
            Ouvrir
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setMenu(null);
              const name = prompt('Nouveau nom du document', menu.meta.name);
              if (name !== null) renameDocument(menu.meta.id, name);
            }}
          >
            Renommer…
          </button>
          <button className="menu-item" onClick={() => (setMenu(null), duplicateDocument(menu.meta.id))}>
            Dupliquer
          </button>
          {workspaces
            .filter((w) => w.id !== ws.id)
            .map((w) => (
              <button key={w.id} className="menu-item" onClick={() => (setMenu(null), moveDocument(menu.meta.id, w.id))}>
                Déplacer vers « {w.name} »
              </button>
            ))}
          <button
            className="menu-item danger"
            onClick={() => {
              setMenu(null);
              if (confirm(`Supprimer « ${menu.meta.name} » ? Cette action est définitive.`)) deleteDocument(menu.meta.id);
            }}
          >
            {icons.trash} Supprimer
          </button>
        </div>
      )}
    </aside>
  );
}

function newWorkspace() {
  const name = prompt('Nom du nouveau workspace', 'Nouveau workspace');
  if (name) createWorkspace(name);
}
