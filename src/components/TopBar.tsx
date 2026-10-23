import { useEffect, useRef, useState, type ReactNode } from 'react';
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

export function TopBar({ onMermaid, onHelp }: { onMermaid: (mode: 'import' | 'export') => void; onHelp: () => void }) {
  const playing = useStore((s) => s.playing);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const zoom = useStore((s) => s.viewport.zoom);
  const sequence = useStore((s) => s.diagram.settings.sequence);
  const { undo, redo, setPlaying, restart, commit } = useStore.getState();

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24">
          <path d="M3 17c4-10 8 4 12-6s4-4 6-4" fill="none" stroke="#6965db" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3">
            <animate attributeName="stroke-dashoffset" values="0;-14" dur="1s" repeatCount="indefinite" />
          </path>
        </svg>
        AnimFlow
      </div>
      <Menu label="Fichier">
        <Item onClick={newDiagram}>Nouveau</Item>
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
        <Item onClick={() => void exportPng()}>PNG (image fixe)</Item>
        <Item onClick={() => onMermaid('export')}>Code Mermaid</Item>
      </Menu>
      <button className="btn" onClick={() => onMermaid('import')}>
        Importer Mermaid
      </button>

      <div className="spacer" />

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
      <label className="toggle" title="Mode séquence : les flux jouent les uns après les autres selon leur délai">
        <input
          type="checkbox"
          checked={sequence}
          onChange={(e) => commit((d) => ({ ...d, settings: { ...d.settings, sequence: e.target.checked } }))}
        />
        Séquence
      </label>
      <div className="sep" />
      <button className="btn" title="Ajuster à l'écran — Maj+1" onClick={zoomToFit}>
        {Math.round(zoom * 100)} %
      </button>
      <button className="icon-btn" title="Aide & raccourcis — ?" onClick={onHelp}>
        {icons.help}
      </button>
    </header>
  );
}
