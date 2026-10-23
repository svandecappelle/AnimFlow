import { useMemo, useState } from 'react';
import { applyAutoSequence, importMermaid, importSequence } from '../actions';
import { EXAMPLE_MERMAID, EXAMPLE_SEQUENCE } from '../example';
import { diagramToMermaid, parseMermaid } from '../io/mermaid';
import { isSequenceDiagram, parseSequence } from '../io/mermaidSequence';
import { useStore } from '../store';
import type { EdgeAnimationType, NodeReveal, Routing } from '../types';

export function MermaidDialog({ mode, onClose }: { mode: 'import' | 'export'; onClose: () => void }) {
  const diagram = useStore((s) => s.diagram);
  const exported = useMemo(() => diagramToMermaid(diagram.nodes, diagram.edges), [diagram]);
  const [source, setSource] = useState(EXAMPLE_MERMAID);
  const [animation, setAnimation] = useState<EdgeAnimationType>('particles');
  const [roughness, setRoughness] = useState(1);
  const [routing, setRouting] = useState<Routing>('straight');
  const [sequence, setSequence] = useState(true);
  const [reveal, setReveal] = useState<NodeReveal>('none');
  const [copied, setCopied] = useState(false);
  const [seqRender, setSeqRender] = useState<'sequence' | 'boxes'>('sequence');
  const [seqAnimation, setSeqAnimation] = useState<EdgeAnimationType>('draw');
  const [seqReveal, setSeqReveal] = useState(true);
  const isSeq = useMemo(() => isSequenceDiagram(source), [source]);

  const chooseRender = (r: 'sequence' | 'boxes') => {
    setSeqRender(r);
    setSeqAnimation(r === 'sequence' ? 'draw' : 'particles');
  };

  const preview = useMemo(() => {
    try {
      if (isSequenceDiagram(source)) {
        const g = parseSequence(source);
        const msgs = g.events.filter((e) => e.kind === 'message').length;
        const notes = g.events.filter((e) => e.kind === 'note').length;
        const blocks = g.events.filter((e) => e.kind === 'blockStart').length;
        if (!g.participants.length) throw new Error('Aucun participant trouvé.');
        return {
          ok: true as const,
          text: `Diagramme de séquence : ${g.participants.length} participants, ${msgs} messages, ${notes} notes, ${blocks} blocs`,
        };
      }
      const g = parseMermaid(source);
      return { ok: true as const, text: `${g.nodes.length} nœuds, ${g.edges.length} liens (${g.direction})` };
    } catch (err) {
      return { ok: false as const, text: (err as Error).message };
    }
  }, [source]);

  const run = (target: 'replace' | 'add' | 'new') => {
    try {
      if (isSeq) {
        // L'ordre des messages fixe déjà les délais : pas de séquençage automatique
        importSequence(source, target, { render: seqRender, animation: seqAnimation, roughness, reveal: seqReveal });
        onClose();
        return;
      }
      importMermaid(source, target, { animation, roughness, routing, reveal });
      // L'apparition progressive suit l'ordre des flux : elle implique le séquençage
      if (sequence || reveal !== 'none') applyAutoSequence();
      onClose();
    } catch (err) {
      alert(`Import impossible : ${(err as Error).message}`);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel" onKeyDown={(e) => e.stopPropagation()}>
        <h2>{mode === 'import' ? 'Importer du Mermaid' : 'Exporter en Mermaid'}</h2>
        {mode === 'export' ? (
          <>
            <p className="muted">
              Les liens animés sont exportés avec la syntaxe <code>e1@&#123; animate: true &#125;</code> (Mermaid ≥ 11.10).
            </p>
            <textarea className="code" readOnly value={exported} rows={16} />
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                Fermer
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  void navigator.clipboard.writeText(exported).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copié ✓' : 'Copier'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              <code>flowchart</code> / <code>graph</code> (mise en page automatique) ou <code>sequenceDiagram</code> (participants,
              messages, notes, blocs <code>loop/alt/opt/par</code>, activations).{' '}
              <button className="link" onClick={() => setSource(EXAMPLE_MERMAID)}>
                Exemple flowchart
              </button>{' '}
              ·{' '}
              <button className="link" onClick={() => setSource(EXAMPLE_SEQUENCE)}>
                Exemple séquence
              </button>
            </p>
            <textarea className="code" value={source} onChange={(e) => setSource(e.target.value)} rows={14} spellCheck={false} autoFocus />
            <p className={preview.ok ? 'muted' : 'error'}>{preview.text}</p>
            {isSeq ? (
              <>
                <div className="render-choice">
                  <button className={seqRender === 'sequence' ? 'active' : ''} onClick={() => chooseRender('sequence')}>
                    <b>Séquence animée</b>
                    <span>Lignes de vie, messages qui se dessinent un par un, notes et blocs qui apparaissent dans l’ordre.</span>
                  </button>
                  <button className={seqRender === 'boxes' ? 'active' : ''} onClick={() => chooseRender('boxes')}>
                    <b>Schéma en boîtes</b>
                    <span>Un participant = une boîte, un message = un lien numéroté ; les flux s’enchaînent chronologiquement.</span>
                  </button>
                </div>
                <div className="form-grid">
                  <label>
                    Animation des messages
                    <select value={seqAnimation} onChange={(e) => setSeqAnimation(e.target.value as EdgeAnimationType)}>
                      <option value="none">Aucune</option>
                      <option value="draw">Tracé progressif</option>
                      <option value="particles">Particules</option>
                      <option value="comet">Comète</option>
                      <option value="flow">Tirets</option>
                    </select>
                  </label>
                  <label>
                    Style
                    <select value={roughness} onChange={(e) => setRoughness(Number(e.target.value))}>
                      <option value={1}>Dessiné à la main</option>
                      <option value={0}>Net (type Mermaid)</option>
                    </select>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={seqReveal} onChange={(e) => setSeqReveal(e.target.checked)} />
                    {seqRender === 'sequence' ? 'Faire apparaître messages, notes et blocs au fil de l’eau' : 'Faire apparaître les boîtes au fil du flux'}
                  </label>
                </div>
                {seqRender === 'boxes' && <p className="muted">En schéma en boîtes, les notes et les blocs (loop, alt…) ne sont pas représentés.</p>}
              </>
            ) : (
              <div className="form-grid">
                <label>
                  Animation des liens
                  <select value={animation} onChange={(e) => setAnimation(e.target.value as EdgeAnimationType)}>
                    <option value="none">Aucune</option>
                    <option value="flow">Tirets</option>
                    <option value="particles">Particules</option>
                    <option value="comet">Comète</option>
                    <option value="draw">Tracé progressif</option>
                  </select>
                </label>
                <label>
                  Style
                  <select value={roughness} onChange={(e) => setRoughness(Number(e.target.value))}>
                    <option value={1}>Dessiné à la main</option>
                    <option value={0}>Net (type Mermaid)</option>
                  </select>
                </label>
                <label>
                  Tracé
                  <select value={routing} onChange={(e) => setRouting(e.target.value as Routing)}>
                    <option value="straight">Droit</option>
                    <option value="curved">Courbe</option>
                    <option value="elbow">Coudé</option>
                  </select>
                </label>
                <label>
                  Apparition des formes
                  <select value={reveal} onChange={(e) => setReveal(e.target.value as NodeReveal)}>
                    <option value="none">Toutes visibles</option>
                    <option value="fade">Au fil du flux (fondu)</option>
                    <option value="pop">Au fil du flux (pop)</option>
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={sequence} onChange={(e) => setSequence(e.target.checked)} />
                  Séquencer le flux automatiquement
                </label>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                Annuler
              </button>
              <button className="btn" disabled={!preview.ok} onClick={() => run('new')}>
                Nouveau document
              </button>
              <button className="btn" disabled={!preview.ok} onClick={() => run('add')}>
                Ajouter au schéma
              </button>
              <button className="btn primary" disabled={!preview.ok} onClick={() => run('replace')}>
                Remplacer le schéma
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
