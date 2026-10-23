import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { zoomToFit } from '../actions';
import { sequenceSteps, stepHoldTime, stepNote } from '../animation';
import { stepItemNames } from '../stepLabels';
import { getCanvasSvg, useStore, type Viewport } from '../store';

/**
 * Mode présentation : plein écran, interface masquée, étapes de la séquence jouées une à une à la demande.
 * Chaque avance joue l'étape suivante puis s'arrête sur son état final ; reculer revient instantanément à l'état
 * de l'étape précédente.
 */
export function Presentation() {
  const diagram = useStore((s) => s.diagram);
  const playing = useStore((s) => s.playing);
  const docName = useStore((s) => s.workspaces.flatMap((w) => w.docs).find((m) => m.id === s.currentDocId)?.name ?? '');
  const steps = useMemo(() => (diagram.settings.sequence ? sequenceSteps(diagram) : []), [diagram]);
  const [index, setIndex] = useState(-1);
  const [running, setRunning] = useState<number | null>(null);
  const [continuous, setContinuous] = useState(false);
  const [hud, setHud] = useState(true);
  const watch = useRef<number | undefined>(undefined);
  const hudTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedViewport = useRef<Viewport>(useStore.getState().viewport);
  const enteredFullscreen = useRef(false);
  const cameraOn = diagram.settings.sequence && diagram.settings.camera !== 'off';
  const [showNotes, setShowNotes] = useState(false);
  const [presenterWin, setPresenterWin] = useState<Window | null>(null);
  const startedAt = useRef(Date.now());
  /** Étape dont les notes s'appliquent : celle qui se joue, sinon la dernière terminée (-1 : introduction) */
  const noteIndex = running ?? index;
  const currentNote = noteIndex < 0 ? (diagram.settings.introNote ?? '').trim() : steps[noteIndex] ? stepNote(diagram, steps[noteIndex]) : '';

  const setPlay = (on: boolean) => {
    const svg = getCanvasSvg();
    if (on) svg?.unpauseAnimations();
    else svg?.pauseAnimations();
    useStore.getState().setPlaying(on);
  };

  /** Affiche l'état « étape i terminée » ; avec `animate`, joue l'étape depuis son début. */
  const goTo = useCallback(
    (i: number, animate: boolean) => {
      const svg = getCanvasSvg();
      if (!svg) return;
      clearTimeout(watch.current);
      setContinuous(false);
      setIndex(i);
      if (!animate || i < 0) {
        setPlay(false);
        setRunning(null);
        svg.setCurrentTime(stepHoldTime(steps, i));
        return;
      }
      const target = stepHoldTime(steps, i);
      svg.setCurrentTime(steps[i].start);
      setRunning(i);
      setPlay(true);
      // Minuteries plutôt que requestAnimationFrame : celui-ci est suspendu quand la fenêtre principale passe au
      // second plan (clic dans la vue présentateur), et l'étape ne se terminerait jamais
      const wait = () => {
        const left = target - svg.getCurrentTime();
        if (left <= 0.01) {
          setPlay(false);
          svg.setCurrentTime(target);
          setRunning(null);
          return;
        }
        watch.current = window.setTimeout(wait, Math.min(left * 1000, 250));
      };
      watch.current = window.setTimeout(wait, 0);
    },
    [steps],
  );

  const next = useCallback(() => {
    if (running !== null) goTo(running, false); // termine l'étape en cours
    else if (index < steps.length - 1) goTo(index + 1, true);
  }, [running, index, steps.length, goTo]);

  const prev = useCallback(() => {
    if (running !== null) goTo(running - 1, false);
    else if (index > -1) goTo(index - 1, false);
  }, [running, index, goTo]);

  const exit = useCallback(() => {
    clearTimeout(watch.current);
    const s = useStore.getState();
    s.setPresenting(false);
    s.setViewport(savedViewport.current);
    getCanvasSvg()?.unpauseAnimations();
    s.setPlaying(true);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  // Entrée : plein écran, état initial, cadrage
  useEffect(() => {
    void document.documentElement
      .requestFullscreen?.()
      .then(() => (enteredFullscreen.current = true))
      .catch(() => {});
    const fit = () => !cameraOn && requestAnimationFrame(() => zoomToFit());
    fit();
    if (steps.length) goTo(-1, false);
    window.addEventListener('resize', fit);
    const onFullscreen = () => {
      // Échap géré par le navigateur pour quitter le plein écran : on quitte aussi la présentation
      if (!document.fullscreenElement && enteredFullscreen.current) exit();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      clearTimeout(watch.current);
      window.removeEventListener('resize', fit);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  const openPresenter = useCallback(() => {
    if (presenterWin && !presenterWin.closed) {
      presenterWin.focus();
      return;
    }
    const win = window.open('', 'animflow-presenter', 'popup,width=820,height=600');
    if (!win) {
      useStore.getState().notify('Le navigateur a bloqué la fenêtre de la vue présentateur : autorisez les fenêtres surgissantes pour cette page.');
      return;
    }
    win.document.title = `Vue présentateur — ${docName || 'AnimFlow'}`;
    win.document.body.innerHTML = '';
    win.document.body.className = 'presenter-body';
    // Mêmes styles que l'application (adresses absolues : la fenêtre est vierge)
    win.document.head.querySelectorAll('style, link').forEach((n) => n.remove());
    document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
      const clone = n.cloneNode(true) as HTMLElement;
      if (clone instanceof HTMLLinkElement) clone.href = (n as HTMLLinkElement).href;
      win.document.head.append(clone);
    });
    win.addEventListener('pagehide', () => setPresenterWin(null));
    setPresenterWin(win);
  }, [presenterWin, docName]);

  // La vue présentateur a sa propre racine React : les clics de sa fenêtre ne remontent pas jusqu'à la page
  const [presenterRoot, setPresenterRoot] = useState<Root | null>(null);
  useEffect(() => {
    if (!presenterWin) return;
    const container = presenterWin.document.createElement('div');
    presenterWin.document.body.append(container);
    const root = createRoot(container);
    setPresenterRoot(root);
    return () => {
      setPresenterRoot(null);
      // Démonté après le rendu en cours (React refuse un démontage synchrone pendant un rendu)
      setTimeout(() => root.unmount());
      presenterWin.close(); // la vue présentateur se ferme avec la présentation
    };
  }, [presenterWin]);

  // Clavier (prioritaire sur les raccourcis de l'éditeur), aussi dans la fenêtre présentateur
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if ((k === 'n' || k === 'N') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setShowNotes((v) => !v);
        return;
      }
      if ((k === 'v' || k === 'V') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openPresenter();
        return;
      }
      const handled = ['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown', 'ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp', 'Home', 'End', 'Escape', 'p', 'P', 'F5'];
      if (!handled.includes(k) || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown'].includes(k)) next();
      else if (['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp'].includes(k)) prev();
      else if (k === 'Home') goTo(-1, false);
      else if (k === 'End') goTo(steps.length - 1, false);
      else if (k === 'Escape') exit();
      else if (k === 'p' || k === 'P') {
        // Lecture continue (boucle complète), comme dans l'éditeur
        clearTimeout(watch.current);
        setRunning(null);
        const on = !(continuous && playing);
        setContinuous(on);
        setPlay(on);
      }
    };
    window.addEventListener('keydown', onKey, true);
    presenterWin?.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      presenterWin?.removeEventListener('keydown', onKey, true);
    };
  }, [next, prev, goTo, exit, steps.length, continuous, playing, openPresenter, presenterWin]);

  // Barre de navigation masquée quand la souris ne bouge plus
  const wake = () => {
    setHud(true);
    clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setHud(false), 2500);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(hudTimer.current);
  }, []);

  const label = !steps.length
    ? diagram.settings.sequence
      ? 'Aucune étape à présenter'
      : 'Mode boucle : activez le mode séquence pour présenter étape par étape'
    : continuous
      ? 'Lecture continue'
      : index < 0
        ? 'Début'
        : `Étape ${index + 1} / ${steps.length}`;

  return (
    <>
      <div
        className="presentation-surface"
        onMouseMove={wake}
        onClick={next}
        onContextMenu={(e) => {
          e.preventDefault();
          prev();
        }}
      />
      {docName && <div className={`presentation-title ${hud ? '' : 'hidden'}`}>{docName}</div>}
      <div className={`presentation-hud panel ${hud ? '' : 'hidden'}`} onMouseMove={wake}>
        <button className="icon-btn" title="Étape précédente (←)" disabled={!steps.length || (index < 0 && running === null)} onClick={prev}>
          ◀
        </button>
        <div className="presentation-progress">
          <span>{label}</span>
          {steps.length > 0 && steps.length <= 40 && (
            <div className="dots">
              {steps.map((_, i) => (
                <button
                  key={i}
                  className={`dot ${i <= index ? 'done' : ''} ${i === running ? 'running' : ''}`}
                  title={`Aller à l’étape ${i + 1}`}
                  onClick={() => goTo(i, false)}
                />
              ))}
            </div>
          )}
        </div>
        <button className="icon-btn" title="Étape suivante (→, Espace, clic)" disabled={!steps.length || (index >= steps.length - 1 && running === null)} onClick={next}>
          ▶
        </button>
        <div className="sep" />
        <button className={`btn ${showNotes ? 'active' : ''}`} title="Afficher les notes à l’écran (N)" onClick={() => setShowNotes((v) => !v)}>
          📝 Notes
        </button>
        <button className="btn" title="Ouvrir la vue présentateur dans une autre fenêtre (V)" onClick={openPresenter}>
          🖥 Vue présentateur
        </button>
        <button className="btn" title="Quitter la présentation (Échap)" onClick={exit}>
          Quitter
        </button>
      </div>
      {showNotes && (
        <div className="presentation-notes panel">
          <div className="notes-title">{noteIndex < 0 ? 'Introduction' : `Notes — étape ${noteIndex + 1}`}</div>
          <div className="notes-text">{currentNote || <span className="muted">Pas de notes pour cette étape.</span>}</div>
        </div>
      )}
      <PresenterRender
        root={presenterRoot}
        view={
          <PresenterView
            title={docName}
            label={label}
            note={currentNote}
            noteTitle={noteIndex < 0 ? 'Introduction' : `Étape ${noteIndex + 1}`}
            nextNames={steps[(running ?? index) + 1] ? stepItemNames(diagram, steps[(running ?? index) + 1]) : null}
            nextNote={steps[(running ?? index) + 1] ? stepNote(diagram, steps[(running ?? index) + 1]) : ''}
            startedAt={startedAt.current}
            onPrev={prev}
            onNext={next}
            canPrev={!!steps.length && !(index < 0 && running === null)}
            canNext={!!steps.length && !(index >= steps.length - 1 && running === null)}
          />
        }
      />
    </>
  );
}

/** Rend la vue présentateur dans sa racine (fenêtre séparée) à chaque mise à jour. */
function PresenterRender({ root, view }: { root: Root | null; view: React.ReactElement }) {
  useEffect(() => {
    root?.render(view);
  });
  return null;
}

/** Vue présentateur (fenêtre séparée) : notes de l'étape, étape suivante, chronomètre, commandes. */
function PresenterView(props: {
  title: string;
  label: string;
  note: string;
  noteTitle: string;
  nextNames: string[] | null;
  nextNote: string;
  startedAt: number;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.floor((now - props.startedAt) / 1000);
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  return (
    <div className="presenter">
      <header className="presenter-head">
        <span className="presenter-doc">{props.title || 'Présentation'}</span>
        <span className="presenter-step">{props.label}</span>
        <span className="presenter-clock" title="Temps écoulé">
          ⏱ {clock}
        </span>
        <button className="btn" disabled={!props.canPrev} onClick={props.onPrev}>
          ◀ Précédent
        </button>
        <button className="btn primary" disabled={!props.canNext} onClick={props.onNext}>
          Suivant ▶
        </button>
      </header>
      <section className="presenter-notes">
        <h3>{props.noteTitle}</h3>
        <div className="presenter-note-text">{props.note || <span className="muted">Pas de notes pour cette étape.</span>}</div>
      </section>
      <section className="presenter-next">
        <h3>Ensuite</h3>
        {props.nextNames ? (
          <>
            <ul>
              {props.nextNames.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            {props.nextNote && <p className="presenter-next-note">{props.nextNote.split('\n')[0]}</p>}
          </>
        ) : (
          <p className="muted">Fin de la présentation.</p>
        )}
      </section>
      <footer className="muted">→ / Espace : suivant · ← : précédent · N : notes à l’écran · Échap : quitter</footer>
    </div>
  );
}
