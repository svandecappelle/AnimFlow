import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zoomToFit } from '../actions';
import { sequenceSteps, stepHoldTime } from '../animation';
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
  const watch = useRef(0);
  const hudTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedViewport = useRef<Viewport>(useStore.getState().viewport);
  const enteredFullscreen = useRef(false);
  const cameraOn = diagram.settings.sequence && diagram.settings.camera !== 'off';

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
      cancelAnimationFrame(watch.current);
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
      const tick = () => {
        if (svg.getCurrentTime() >= target) {
          setPlay(false);
          svg.setCurrentTime(target);
          setRunning(null);
          return;
        }
        watch.current = requestAnimationFrame(tick);
      };
      watch.current = requestAnimationFrame(tick);
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
    cancelAnimationFrame(watch.current);
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
      cancelAnimationFrame(watch.current);
      window.removeEventListener('resize', fit);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  // Clavier (prioritaire sur les raccourcis de l'éditeur)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
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
        cancelAnimationFrame(watch.current);
        setRunning(null);
        const on = !(continuous && playing);
        setContinuous(on);
        setPlay(on);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, prev, goTo, exit, steps.length, continuous, playing]);

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
        <button className="btn" title="Quitter la présentation (Échap)" onClick={exit}>
          Quitter
        </button>
      </div>
    </>
  );
}
