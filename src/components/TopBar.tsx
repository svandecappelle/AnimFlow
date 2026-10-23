import { useEffect, useRef, useState, type ReactNode } from 'react';
import { renameDocument } from '../workspaceActions';
import { exportPng, exportSvg, newDiagram, openFile, saveJson, zoomToFit } from '../actions';
import { useStore } from '../store';
import { icons } from './icons';

function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`btn ${open ? 'active' : ''}`} onClick={() => setOpen(!open)}>
        {label} ▾
      </button>
      {open && (
        <div className="menu-list panel" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

const Item = ({ onClick, children, hint }: { onClick: () => void; children: ReactNode; hint?: string }) => (
  <button className="menu-item" onClick={onClick}>
    <span>{children}</span>
    {hint && <span className="hint">{hint}</span>}
  </button>
);

export function TopBar({
  onMermaid,
  onHelp,
  onVideo,
  onShare,
}: {
  onMermaid: (mode: 'import' | 'export') => void;
  onHelp: () => void;
  onVideo: () => void;
  onShare: () => void;
}) {
  const playing = useStore((s) => s.playing);
  const canUndo = useStore((s) => (s.collab ? s.collab.canUndo : s.past.length > 0));
  const canRedo = useStore((s) => (s.collab ? s.collab.canRedo : s.future.length > 0));
  const collab = useStore((s) => s.collab);
  const peers = useStore((s) => s.peers);
  const zoom = useStore((s) => s.viewport.zoom);
  const sequence = useStore((s) => s.diagram.settings.sequence);
  const camera = useStore((s) => s.diagram.settings.camera);
  const cameraSuspended = useStore((s) => s.cameraSuspended);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const { undo, redo, setPlaying, restart, commit, setCameraSuspended, setSidebarOpen } = useStore.getState();

  return (
    <header className="topbar">
      <button
        className={`icon-btn ${sidebarOpen ? 'active' : ''}`}
        title="Documents et workspaces — B"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        ☰
      </button>
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24">
          <path d="M3 17c4-10 8 4 12-6s4-4 6-4" fill="none" stroke="#6965db" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="0;-14" dur="1s" repeatCount="indefinite" />
          </path>
        </svg>
        AnimFlow
      </div>
      <DocTitle />
      <Menu label="Fichier">
        <Item onClick={newDiagram}>Nouveau document</Item>
        <Item onClick={openFile} hint="Ctrl+O">
          Ouvrir… (.json, .svg, .mmd)
        </Item>
        <Item onClick={saveJson} hint="Ctrl+S">
          Enregistrer (.animflow.json)
        </Item>
      </Menu>
      <Menu label="Exporter">
        <Item onClick={exportSvg} hint="Ctrl+E">
          SVG animé (ré-importable)
        </Item>
        <Item onClick={onVideo} hint="Ctrl+Maj+E">
          Vidéo (MP4, WebM, GIF)…
        </Item>
        <Item onClick={() => void exportPng()}>PNG (image fixe)</Item>
        <Item onClick={() => onMermaid('export')}>Code Mermaid</Item>
      </Menu>
      <button className="btn" onClick={() => onMermaid('import')}>
        Importer Mermaid
      </button>

      <div className="spacer" />

      {collab && (
        <div className="avatars" onClick={onShare} title={peers.map((p) => p.name).join(', ') || 'Seul dans la session'}>
          {peers.slice(0, 5).map((p) => (
            <span key={p.clientId} className="avatar" style={{ background: p.color }}>
              {p.name.charAt(0).toUpperCase()}
            </span>
          ))}
          {peers.length > 5 && <span className="avatar more">+{peers.length - 5}</span>}
        </div>
      )}
      <button
        className={`btn share-btn ${collab ? (collab.status === 'connected' ? 'live' : 'warn') : ''}`}
        title="Collaboration en direct"
        onClick={onShare}
      >
        {collab ? <span className={`status-dot ${collab.status}`} /> : '👥'} {collab ? `En direct · ${peers.length + 1}` : 'Partager'}
      </button>
      <div className="sep" />

      <button className="icon-btn" title="Annuler — Ctrl+Z" disabled={!canUndo} onClick={undo}>
        {icons.undo}
      </button>
      <button className="icon-btn" title="Rétablir — Ctrl+Maj+Z" disabled={!canRedo} onClick={redo}>
        {icons.redo}
      </button>
      <div className="sep" />
      <button className={`icon-btn ${playing ? '' : 'active'}`} title="Lecture / pause — P" onClick={() => setPlaying(!playing)}>
        {playing ? icons.pause : icons.play}
      </button>
      <button className="icon-btn" title="Recommencer l'animation" onClick={restart}>
        {icons.restart}
      </button>
      <button className="btn present-btn" title="Mode présentation — F5" onClick={() => useStore.getState().setPresenting(true)}>
        ▶ Présenter
      </button>
      <label className="toggle" title="Mode séquence : les flux jouent les uns après les autres selon leur délai">
        <input
          type="checkbox"
          checked={sequence}
          onChange={(e) => commit((d) => ({ ...d, settings: { ...d.settings, sequence: e.target.checked } }))}
        />
        Séquence
      </label>
      <button
        className={`btn ${camera !== 'off' && !cameraSuspended ? 'active' : ''}`}
        title={
          camera === 'off'
            ? 'Caméra : suivre les éléments animés (mode séquence) — C'
            : cameraSuspended
              ? 'Caméra en pause (vue déplacée à la main) : cliquer pour reprendre le suivi'
              : 'Caméra active : cliquer pour la désactiver'
        }
        onClick={() => {
          if (camera !== 'off' && cameraSuspended) setCameraSuspended(false);
          else
            commit((d) => ({
              ...d,
              settings: { ...d.settings, camera: camera === 'off' ? 'medium' : 'off', sequence: camera === 'off' ? true : d.settings.sequence },
            }));
        }}
      >
        🎥 {camera === 'off' ? 'Caméra' : cameraSuspended ? 'Reprendre' : 'Suivi'}
      </button>
      <div className="sep" />
      <button
        className="btn"
        title="Ajuster à l'écran — Maj+1"
        onClick={() => {
          setCameraSuspended(true);
          zoomToFit();
        }}
      >
        {Math.round(zoom * 100)} %
      </button>
      <ThemeButton />
      <button className="icon-btn" title="Aide & raccourcis — ?" onClick={onHelp}>
        {icons.help}
      </button>
    </header>
  );
}

/** « Workspace / Document » ; clic sur le nom du document pour le renommer. */
function DocTitle() {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === s.currentWorkspaceId));
  const docId = useStore((s) => s.currentDocId);
  const name = ws?.docs.find((m) => m.id === docId)?.name ?? 'Sans titre';
  const [editing, setEditing] = useState(false);
  return (
    <div className="doc-title">
      <span className="ws-name" onClick={() => useStore.getState().setSidebarOpen(true)} title="Afficher les documents">
        {ws?.name}
      </span>
      <span className="slash">/</span>
      {editing ? (
        <input
          className="inline-input"
          defaultValue={name}
          autoFocus
          onFocus={(e) => e.target.select()}
          onBlur={(e) => {
            renameDocument(docId, e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="doc-name" onClick={() => setEditing(true)} title="Cliquer pour renommer">
          {name}
        </span>
      )}
    </div>
  );
}

const THEMES = [
  { value: 'light', icon: '☀️', label: 'Clair' },
  { value: 'dark', icon: '🌙', label: 'Sombre' },
  { value: 'system', icon: '🖥️', label: 'Système' },
] as const;

/** Thème de l'interface : clair → sombre → système (Alt+Maj+D bascule clair / sombre). */
function ThemeButton() {
  const theme = useStore((s) => s.theme);
  const i = THEMES.findIndex((t) => t.value === theme);
  const current = THEMES[i];
  const next = THEMES[(i + 1) % THEMES.length];
  return (
    <button
      className="icon-btn"
      title={`Thème : ${current.label} — cliquer pour « ${next.label} » (Alt+Maj+D : clair / sombre)`}
      onClick={() => useStore.getState().setTheme(next.value)}
    >
      {current.icon}
    </button>
  );
}
