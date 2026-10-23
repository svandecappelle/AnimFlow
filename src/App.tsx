import { lazy, Suspense, useEffect, useState } from 'react';
import {
  clipboardPayload,
  deleteSelected,
  duplicateSelected,
  exportSvg,
  importFile,
  nudgeSelected,
  reverseSelectedEdges,
  openFile,
  pasteText,
  saveJson,
  selectAll,
  zoomToFit,
} from './actions';
import { Canvas } from './components/Canvas';
import { MermaidDialog } from './components/MermaidDialog';
import { Presentation } from './components/Presentation';
import { RightPanel } from './components/RightPanel';
import { ShareDialog } from './components/ShareDialog';
import { Sidebar } from './components/Sidebar';
import { roomFromHash } from './collab';
import { joinRoom } from './workspaceActions';
import { Timeline } from './components/Timeline';
import { TOOL_KEYS, Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { useStore } from './store';
import { applyTheme, onSystemThemeChange, resolveTheme } from './theme';

// Chargé à la demande : l'encodeur vidéo est volumineux
const VideoDialog = lazy(() => import('./components/VideoDialog').then((m) => ({ default: m.VideoDialog })));

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));

const SHORTCUTS: [string, string][] = [
  ['V / H', 'Sélection / main'],
  ['R U O D', 'Rectangle, arrondi, ellipse, losange'],
  ['A', 'Flèche : glisser d’une forme à une autre'],
  ['T ou double-clic', 'Texte (double-clic sur une forme : éditer)'],
  ['Espace + glisser', 'Déplacer la vue (ou clic molette)'],
  ['Ctrl + molette', 'Zoom'],
  ['Maj + 1', 'Ajuster à l’écran'],
  ['Alt + glisser', 'Aimanter sur la grille'],
  ['Maj + clic', 'Sélection multiple'],
  ['Ctrl+C / Ctrl+V', 'Copier / coller (colle aussi depuis Excalidraw, du Mermaid ou du JSON)'],
  ['Ctrl+D', 'Dupliquer'],
  ['Ctrl+Z / Ctrl+Maj+Z', 'Annuler / rétablir'],
  ['Suppr', 'Supprimer'],
  ['Flèches', 'Déplacer (Maj : ×10)'],
  ['F5', 'Mode présentation (→ / ← : étapes, L : laser, N : notes, V : vue présentateur, Échap : quitter)'],
  ['B', 'Panneau des documents et workspaces'],
  ['Alt+Maj+D', 'Mode sombre / clair'],
  ['P', 'Lecture / pause des animations'],
  ['L', 'Panneau « Ordre des étapes »'],
  ['Maj+R', 'Inverser le lien sélectionné'],
  ['C', 'Caméra qui suit l’animation (mode séquence)'],
  ['Ctrl+S / Ctrl+O / Ctrl+E', 'Enregistrer / ouvrir / exporter SVG animé'],
  ['Ctrl+Maj+E', 'Exporter en vidéo (MP4, WebM, GIF)'],
];

export default function App() {
  const [mermaid, setMermaid] = useState<'import' | 'export' | null>(null);
  const [help, setHelp] = useState(false);
  const [video, setVideo] = useState(false);
  const [share, setShare] = useState(false);
  const [dropping, setDropping] = useState(false);
  const sequence = useStore((s) => s.diagram.settings.sequence);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toast = useStore((s) => s.toast);
  const presenting = useStore((s) => s.presenting);

  useEffect(() => {
    requestAnimationFrame(() => zoomToFit());
  }, []);

  // Mode « Système » : suit le réglage de l'ordinateur
  useEffect(() => onSystemThemeChange(() => applyTheme(useStore.getState().theme)), []);

  // Lien de collaboration (#room=…) : à l'ouverture et quand il change
  useEffect(() => {
    const join = () => {
      const room = roomFromHash();
      if (room && useStore.getState().collab?.room !== room) {
        joinRoom(room);
        setShare(true);
        requestAnimationFrame(() => zoomToFit());
      }
    };
    join();
    window.addEventListener('hashchange', join);
    return () => window.removeEventListener('hashchange', join);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F5 lance la présentation même depuis un champ de saisie (sinon le navigateur recharge la page)
      if (e.key === 'F5' && !e.ctrlKey && !e.metaKey && !useStore.getState().presenting) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        useStore.getState().setPresenting(true);
        return;
      }
      if (isTyping(e.target)) return;
      const s = useStore.getState();
      if (s.editingId) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.altKey && e.shiftKey && e.code === 'KeyD') {
        // Alt+Maj+D (comme Excalidraw) : bascule clair / sombre
        s.setTheme(resolveTheme(s.theme) === 'dark' ? 'light' : 'dark');
        e.preventDefault();
        return;
      }
      if (mod) {
        if (k === 'z') (e.shiftKey ? s.redo : s.undo)();
        else if (k === 'y') s.redo();
        else if (k === 'd') duplicateSelected();
        else if (k === 'a') selectAll();
        else if (k === 's') saveJson();
        else if (k === 'o') void openFile();
        else if (k === 'e' && e.shiftKey) setVideo(true);
        else if (k === 'e') exportSvg();
        else return;
        e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      else if (e.key === 'Escape') {
        s.select([]);
        s.setTool('select');
        setHelp(false);
      } else if (e.key.startsWith('Arrow')) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelected(dx, dy);
      } else if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) {
        s.setCameraSuspended(true);
        zoomToFit();
      } else if (k === 'c') {
        // Caméra : active / reprend / désactive
        const cam = s.diagram.settings.camera;
        if (cam !== 'off' && s.cameraSuspended) s.setCameraSuspended(false);
        else s.commit((d) => ({ ...d, settings: { ...d.settings, camera: cam === 'off' ? 'medium' : 'off', sequence: cam === 'off' || d.settings.sequence } }));
      }
      else if (e.key === '?') setHelp((h) => !h);
      else if (k === 'p') s.setPlaying(!s.playing);
      else if (k === 'b') s.setSidebarOpen(!s.sidebarOpen);
      else if (k === 'r' && e.shiftKey) reverseSelectedEdges();
      else if (k === 'l') s.setRightTab(s.rightTab === 'order' ? 'props' : 'order');
      else if (TOOL_KEYS[k]) s.setTool(TOOL_KEYS[k]);
      else if (k === 'enter' && s.selectedIds.length === 1) s.setEditing(s.selectedIds[0]);
      else return;
      e.preventDefault();
    };
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const payload = clipboardPayload();
      if (!payload) return;
      e.clipboardData?.setData('text/plain', payload);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      onCopy(e);
      if (e.defaultPrevented) deleteSelected();
    };
    // Linux : le clic molette colle la « sélection primaire ». On le désactive dans toute l'interface
    // (le clic molette reste utilisé pour déplacer la vue sur le canevas, via les pointer events).
    let lastMiddleClick = 0;
    const blockMiddle = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      lastMiddleClick = Date.now();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (Date.now() - lastMiddleClick < 1000) {
        e.preventDefault();
        return;
      }
      if (isTyping(e.target)) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text && pasteText(text)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste, true);
    for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) window.addEventListener(type, blockMiddle, true);
    return () => {
      for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) window.removeEventListener(type, blockMiddle, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste, true);
    };
  }, []);

  return (
    <div
      className={`app ${presenting ? 'presenting' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const file = e.dataTransfer.files[0];
        if (file) void importFile(file, e.shiftKey ? 'add' : 'new');
      }}
    >
      <TopBar onMermaid={setMermaid} onHelp={() => setHelp(true)} onVideo={() => setVideo(true)} onShare={() => setShare(true)} />
      <main className={`workspace ${sidebarOpen ? 'with-sidebar' : ''}`}>
        <Canvas />
        {sidebarOpen && <Sidebar />}
        <Toolbar />
        <RightPanel />
        {sequence && <Timeline />}
        {toast && <div className="toast panel" role="status">{toast}</div>}
        {presenting && <Presentation />}
        {dropping && <div className="drop-overlay">Déposez un fichier (schéma, workspace, .excalidraw, SVG AnimFlow ou Mermaid) : ouvert dans un nouveau document — Maj : ajouter au document courant</div>}
      </main>
      {mermaid && <MermaidDialog mode={mermaid} onClose={() => setMermaid(null)} />}
      {share && <ShareDialog onClose={() => setShare(false)} />}
      {video && (
        <Suspense fallback={null}>
          <VideoDialog onClose={() => setVideo(false)} />
        </Suspense>
      )}
      {help && (
        <div className="modal-backdrop" onMouseDown={() => setHelp(false)}>
          <div className="modal panel" onMouseDown={(e) => e.stopPropagation()}>
            <h2>Raccourcis</h2>
            <table className="shortcuts">
              <tbody>
                {SHORTCUTS.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">
              Astuce : activez le mode <b>Séquence</b> puis « Séquencer automatiquement » pour que les flux s’enchaînent le long du
              graphe. L’export <b>SVG animé</b> fonctionne dans n’importe quel navigateur, et peut être ré-ouvert dans AnimFlow.
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setHelp(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
