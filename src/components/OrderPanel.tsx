import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { applyAutoSequence } from '../actions';
import { applyStepOrder, sequenceCycle, sequenceSteps, stepNote, withStepNote, type StepItem } from '../animation';
import { edgeName, nodeName } from '../stepLabels';
import { getCanvasSvg, useStore } from '../store';
import type { Diagram } from '../types';

const ANIM_ICONS: Record<string, string> = { flow: '┅', particles: '•••', comet: '☄', draw: '✎', none: '▭' };

/**
 * Notes du présentateur (étape ou introduction). Une seule entrée d'historique par séance d'édition ; le texte
 * suit les modifications venues d'ailleurs (annulation, collaborateurs) quand le champ n'a pas le focus.
 */
function NoteField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  return (
    <textarea
      className="step-note"
      value={text}
      placeholder={placeholder}
      rows={Math.min(8, Math.max(2, text.split('\n').length))}
      onFocus={() => {
        setFocused(true);
        useStore.getState().pushHistory();
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}
/** Où déposer l'élément glissé : dans une étape (démarre avec elle) ou entre deux étapes (nouvelle étape). */
type DropTarget = { kind: 'join'; step: number } | { kind: 'insert'; index: number };

export function OrderPanel() {
  const diagram = useStore((s) => s.diagram);
  const selectedIds = useStore((s) => s.selectedIds);
  const { select, commit, apply } = useStore.getState();
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const steps = useMemo(() => sequenceSteps(diagram), [diagram]);
  const nodes = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram.nodes]);
  const edges = useMemo(() => new Map(diagram.edges.map((e) => [e.id, e])), [diagram.edges]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Étape en cours de lecture surlignée
  useEffect(() => {
    if (!diagram.settings.sequence) return;
    const cycle = sequenceCycle(diagram);
    let raf = 0;
    const tick = () => {
      const svg = getCanvasSvg();
      const t = svg ? svg.getCurrentTime() % cycle : -1;
      listRef.current?.querySelectorAll<HTMLElement>('.step').forEach((el, i) => {
        const s = steps[i];
        el.classList.toggle('playing', !!s && t >= s.start && t < Math.max(s.end, s.start + 0.3));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [diagram, steps]);

  if (!diagram.settings.sequence) {
    return (
      <div className="props-body">
        <p className="muted">
          L’ordre des étapes s’applique en <b>mode séquence</b> : les animations jouent les unes après les autres, puis le cycle
          recommence.
        </p>
        <button className="btn wide" onClick={applyAutoSequence}>
          ⚡ Activer et séquencer automatiquement
        </button>
      </div>
    );
  }

  const order = () => steps.map((s) => s.items.map((i) => i.id));

  const drop = (t: DropTarget) => {
    if (!dragging) return;
    const next = order().map((ids) => ids.filter((id) => id !== dragging));
    if (t.kind === 'join') next[t.step].push(dragging);
    else next.splice(t.index, 0, [dragging]);
    commit((d: Diagram) => applyStepOrder(d, next.filter((s) => s.length)));
    setDragging(null);
    setTarget(null);
  };

  const dragProps = (t: DropTarget) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(t);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drop(t);
    },
  });
  const isTarget = (t: DropTarget) => !!target && target.kind === t.kind && (t.kind === 'join' ? target.kind === 'join' && target.step === t.step : target.kind === 'insert' && target.index === t.index);

  const itemRow = (it: StepItem) => {
    const e = it.kind === 'edge' ? edges.get(it.id) : undefined;
    const n = it.kind === 'node' ? nodes.get(it.id) : undefined;
    const color = e ? (e.animation.color ?? e.strokeColor) : (n?.strokeColor ?? '#868e96');
    const icon = e ? ANIM_ICONS[e.animation.type] : '◻';
    const name = e ? edgeName(e, nodes) : `Apparition : ${nodeName(n)}`;
    return (
      <div
        key={it.id}
        className={`step-item ${selectedIds.includes(it.id) ? 'selected' : ''} ${dragging === it.id ? 'dragging' : ''}`}
        draggable
        onDragStart={(ev) => {
          ev.dataTransfer.effectAllowed = 'move';
          ev.dataTransfer.setData('text/plain', it.id);
          setDragging(it.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setTarget(null);
        }}
        onClick={(ev) => select(ev.shiftKey ? [...new Set([...selectedIds, it.id])] : [it.id])}
        title="Glisser pour changer l’ordre — clic : sélectionner"
      >
        <span className="grip">⋮⋮</span>
        <span className="step-icon" style={{ color }}>
          {icon}
        </span>
        <span className="step-name">{name}</span>
        <span className="step-dur">{it.duration.toFixed(1)} s</span>
      </div>
    );
  };

  const staticEdges = diagram.edges.filter((e) => e.animation.type === 'none' && !e.reveal).length;

  return (
    <div className="props-body order-panel">
      <div className="order-head">
        <span className="muted">
          {steps.length} étape{steps.length > 1 ? 's' : ''} · {diagram.settings.manualOrder ? 'ordre manuel' : 'ordre automatique (graphe)'}
        </span>
        <button className="btn small-outline" onClick={applyAutoSequence} title="Recalcule l’ordre en suivant les flèches">
          ⚡ Auto
        </button>
      </div>
      <p className="muted hint">
        Glissez un élément <b>sur une étape</b> pour qu’il démarre avec elle, ou <b>entre deux étapes</b> pour en créer une nouvelle.
      </p>

      <details className="intro-note" open={!!diagram.settings.introNote || undefined}>
        <summary>📝 Note d’introduction (avant la 1re étape)</summary>
        <NoteField
          value={diagram.settings.introNote ?? ''}
          placeholder="Ce que vous direz avant de lancer la première étape…"
          onChange={(v) => apply((d) => ({ ...d, settings: { ...d.settings, introNote: v.trim() ? v : undefined } }))}
        />
      </details>

      <div className="step-list" ref={listRef}>
        {steps.map((s, i) => (
          <div key={i}>
            <div className={`step-gap ${isTarget({ kind: 'insert', index: i }) ? 'over' : ''}`} {...dragProps({ kind: 'insert', index: i })} />
            <div className={`step ${isTarget({ kind: 'join', step: i }) ? 'over' : ''}`} {...dragProps({ kind: 'join', step: i })}>
              <div className="step-title">
                <span>Étape {i + 1}</span>
                <span className="muted">
                  {s.start.toFixed(1)} s → {s.end.toFixed(1)} s
                  <button
                    className={`note-toggle ${stepNote(diagram, s) ? 'has-note' : ''}`}
                    title="Notes du présentateur pour cette étape"
                    onClick={() =>
                      setOpenNotes((prev) => {
                        const next = new Set(prev);
                        const key = s.items[0].id;
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    📝
                  </button>
                </span>
              </div>
              {s.items.map(itemRow)}
              {s.arrivals.map((id) => (
                <div key={id} className="step-arrival" onClick={() => select([id])} title="Apparaît à l’arrivée du flux (Auto)">
                  ↳ apparaît : {nodeName(nodes.get(id))}
                </div>
              ))}
              {(stepNote(diagram, s) || openNotes.has(s.items[0].id)) && (
                <NoteField
                  key={s.items[0].id}
                  value={stepNote(diagram, s)}
                  placeholder="Notes du présentateur pour cette étape…"
                  onChange={(v) => apply((d) => withStepNote(d, s.items.map((it) => it.id), v))}
                />
              )}
            </div>
          </div>
        ))}
        <div className={`step-gap last ${isTarget({ kind: 'insert', index: steps.length }) ? 'over' : ''}`} {...dragProps({ kind: 'insert', index: steps.length })}>
          {dragging && 'Déposer ici : nouvelle étape à la fin'}
        </div>
        {!steps.length && <p className="muted center">Aucune animation : choisissez un effet sur des liens (onglet Propriétés).</p>}
      </div>
      {staticEdges > 0 && (
        <p className="muted hint">
          {staticEdges} lien{staticEdges > 1 ? 's' : ''} sans animation (toujours visible{staticEdges > 1 ? 's' : ''}) : sélectionnez-les et choisissez un
          effet pour les ajouter à la séquence.
        </p>
      )}
    </div>
  );
}
