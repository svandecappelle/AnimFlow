import type { ReactNode } from 'react';
import { applyAutoSequence, deleteSelected, duplicateSelected, reverseSelectedEdges, snapFreeEdges } from '../actions';
import { retime, sequenceCycle } from '../animation';
import { BACKGROUND_COLORS, FILL_COLORS, STROKE_COLORS } from '../defaults';
import { useStore } from '../store';
import { plural } from '../text';
import type { EdgeAnimation, EdgeElement, NodeElement, NodeReveal } from '../types';
import { icons } from './icons';

type Opt<T> = { value: T; label: ReactNode; title?: string };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

function Segmented<T extends string | number | boolean>({ options, value, onChange }: { options: Opt<T>[]; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} title={o.title} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Colors({ colors, value, onChange }: { colors: string[]; value: string | undefined; onChange: (c: string) => void }) {
  return (
    <div className="colors">
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch ${c === value ? 'active' : ''} ${c === 'transparent' ? 'transparent' : ''}`}
          style={{ background: c === 'transparent' ? undefined : c }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
      <input
        type="color"
        className="color-input"
        value={value && value.startsWith('#') && value.length === 7 ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        title="Couleur personnalisée"
      />
    </div>
  );
}

/** Curseur : une seule entrée d'historique par geste. */
function Slider(props: { min: number; max: number; step: number; value: number; onChange: (v: number) => void; unit?: string }) {
  const pushHistory = useStore((s) => s.pushHistory);
  return (
    <div className="slider">
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onPointerDown={pushHistory}
        onKeyDown={pushHistory}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="value">
        {props.value}
        {props.unit}
      </span>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="row">
    <label>{label}</label>
    {children}
  </div>
);

function first<T, K extends keyof T>(items: T[], key: K): T[K] | undefined {
  return items[0]?.[key];
}

export function PropertiesPanel() {
  const diagram = useStore((s) => s.diagram);
  const selectedIds = useStore((s) => s.selectedIds);
  const { commit, apply } = useStore.getState();
  const ids = new Set(selectedIds);
  const nodes = diagram.nodes.filter((n) => ids.has(n.id));
  const edges = diagram.edges.filter((e) => ids.has(e.id));

  // `live` : modification continue (curseur), l'historique a déjà été poussé
  const patchNodes = (patch: Partial<NodeElement>, live = false) =>
    (live ? apply : commit)((d) => ({ ...d, nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, ...patch } : n)) }));
  const patchEdges = (patch: Partial<EdgeElement>, live = false) =>
    (live ? apply : commit)((d) => ({ ...d, edges: d.edges.map((e) => (ids.has(e.id) ? { ...e, ...patch } : e)) }));
  const patchAnim = (patch: Partial<EdgeAnimation>, live = false) =>
    (live ? apply : commit)((d) => ({
      ...d,
      edges: d.edges.map((e) => (ids.has(e.id) ? { ...e, animation: { ...e.animation, ...patch } } : e)),
    }));
  /** L'apparition progressive n'a de sens qu'en mode séquence : on l'active au passage. */
  const setReveal = (reveal: NodeReveal, all = false) =>
    commit((d) => ({
      ...d,
      settings: reveal !== 'none' ? { ...d.settings, sequence: true } : d.settings,
      nodes: d.nodes.map((n) => (all || ids.has(n.id) ? { ...n, reveal } : n)),
    }));
  const revealOptions: Opt<NodeReveal>[] = [
    { value: 'none', label: 'Toujours', title: 'Toujours visible' },
    { value: 'fade', label: 'Fondu', title: 'Apparaît en fondu à l’arrivée du flux' },
    { value: 'pop', label: 'Pop', title: 'Apparaît avec un effet de zoom à l’arrivée du flux' },
  ];

  type Shared = Partial<Pick<NodeElement, 'strokeColor' | 'strokeWidth' | 'roughness' | 'fontFamily' | 'fontSize'>>;
  const patchBoth = (patch: Shared, live = false) =>
    (live ? apply : commit)((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, ...patch } : n)),
      edges: d.edges.map((e) => (ids.has(e.id) ? { ...e, ...patch } : e)),
    }));

  if (!nodes.length && !edges.length) {
    const s = diagram.settings;
    return (
      <div className="props-body">
        <Section title="Schéma">
          <Row label="Fond">
            <Colors colors={BACKGROUND_COLORS} value={s.background} onChange={(background) => commit((d) => ({ ...d, settings: { ...d.settings, background } }))} />
          </Row>
        </Section>
        <Section title="Animation globale">
          <Row label="Mode">
            <Segmented
              value={s.sequence}
              onChange={(sequence) => commit((d) => ({ ...d, settings: { ...d.settings, sequence } }))}
              options={[
                { value: false, label: 'Boucle', title: 'Chaque flux boucle indépendamment' },
                { value: true, label: 'Séquence', title: 'Les flux jouent dans l’ordre de leurs délais' },
              ]}
            />
          </Row>
          {s.sequence ? (
            <Row label="Pause entre les animations">
              <Slider
                min={0}
                max={5}
                step={0.1}
                value={s.stepPause}
                unit=" s"
                onChange={(stepPause) => apply((d) => retime({ ...d, settings: { ...d.settings, stepPause } }))}
              />
            </Row>
          ) : (
            <Row label="Pause entre les répétitions">
              <Slider
                min={0}
                max={5}
                step={0.1}
                value={s.loopPause}
                unit=" s"
                onChange={(loopPause) => apply((d) => ({ ...d, settings: { ...d.settings, loopPause } }))}
              />
            </Row>
          )}
          {s.sequence && (
            <>
              <Row label="Pause en fin de cycle">
                <Slider
                  min={0}
                  max={5}
                  step={0.1}
                  value={s.sequenceGap}
                  unit=" s"
                  onChange={(sequenceGap) => apply((d) => ({ ...d, settings: { ...d.settings, sequenceGap } }))}
                />
              </Row>
              <p className="muted">Cycle : {sequenceCycle(diagram).toFixed(1)} s</p>
            </>
          )}
          <button className="btn wide" onClick={applyAutoSequence} title="Calcule les délais en suivant le graphe depuis les sources">
            ⚡ Séquencer automatiquement
          </button>
          <Row label="Caméra qui suit l’animation">
            <Segmented
              value={s.camera}
              onChange={(camera) => {
                commit((d) => ({ ...d, settings: { ...d.settings, camera, sequence: camera !== 'off' ? true : d.settings.sequence } }));
                useStore.getState().setCameraSuspended(false);
              }}
              options={[
                { value: 'off', label: 'Non' },
                { value: 'veryClose', label: 'Très proche', title: 'Zoom très serré (jusqu’à 300 %) : pour suivre un détail sur un grand schéma' },
                { value: 'close', label: 'Proche', title: 'Zoom serré sur l’élément animé' },
                { value: 'medium', label: 'Moyen' },
                { value: 'wide', label: 'Large', title: 'Garde plus de contexte autour' },
              ]}
            />
          </Row>
          {s.camera !== 'off' && (
            <p className="muted">
              Pendant la lecture, la vue suit les éléments animés puis montre l’ensemble en fin de cycle. Zoomer ou déplacer
              la vue met la caméra en pause ; Lecture ou 🎥 la relance. Aussi appliqué au SVG exporté.
            </p>
          )}
          <Row label="Apparition des formes au fil du flux">
            <Segmented
              value={diagram.nodes.length && diagram.nodes.every((n) => n.reveal === diagram.nodes[0].reveal) ? diagram.nodes[0].reveal : undefined}
              onChange={(r) => setReveal(r, true)}
              options={revealOptions}
            />
          </Row>
        </Section>
        <p className="muted">
          {plural(diagram.nodes.length, 'forme')} · {plural(diagram.edges.length, 'lien')}
          <br />
          Sélectionnez un élément pour modifier son style et son animation.
        </p>
      </div>
    );
  }

  const anim = edges[0]?.animation;

  return (
    <div className="props-body">
      <Section title="Trait">
        <Colors
          colors={STROKE_COLORS}
          value={first(nodes, 'strokeColor') ?? first(edges, 'strokeColor')}
          onChange={(strokeColor) =>
            nodes.length && nodes.every((n) => n.textColor === n.strokeColor)
              ? commit((d) => ({
                  ...d,
                  nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, strokeColor, textColor: strokeColor } : n)),
                  edges: d.edges.map((e) => (ids.has(e.id) ? { ...e, strokeColor } : e)),
                }))
              : patchBoth({ strokeColor })
          }
        />
        <Row label="Épaisseur">
          <Segmented
            value={first(nodes, 'strokeWidth') ?? first(edges, 'strokeWidth')}
            onChange={(strokeWidth) => patchBoth({ strokeWidth })}
            options={[
              { value: 1, label: 'Fin' },
              { value: 2, label: 'Moyen' },
              { value: 3.5, label: 'Épais' },
            ]}
          />
        </Row>
        <Row label="Style">
          <Segmented
            value={first(nodes, 'roughness') ?? first(edges, 'roughness')}
            onChange={(roughness) => patchBoth({ roughness })}
            options={[
              { value: 0, label: 'Net', title: 'Style Mermaid' },
              { value: 1, label: 'Main', title: 'Style Excalidraw' },
              { value: 2, label: 'Brouillon' },
            ]}
          />
        </Row>
      </Section>

      {nodes.length > 0 && (
        <Section title="Forme">
          {nodes.some((n) => n.shape !== 'text') && (
            <>
              <Row label="Type">
                <Segmented
                  value={first(nodes, 'shape')}
                  onChange={(shape) => patchNodes({ shape })}
                  options={[
                    { value: 'rectangle', label: icons.rectangle, title: 'Rectangle' },
                    { value: 'rounded', label: icons.rounded, title: 'Arrondi' },
                    { value: 'ellipse', label: icons.ellipse, title: 'Ellipse' },
                    { value: 'diamond', label: icons.diamond, title: 'Losange' },
                  ]}
                />
              </Row>
              <Row label="Remplissage">
                <Colors
                  colors={FILL_COLORS}
                  value={first(nodes, 'fillStyle') === 'none' ? 'transparent' : first(nodes, 'fillColor')}
                  onChange={(fillColor) =>
                    patchNodes(
                      fillColor === 'transparent'
                        ? { fillColor, fillStyle: 'none' }
                        : { fillColor, fillStyle: nodes[0].fillStyle === 'none' ? 'hachure' : nodes[0].fillStyle },
                    )
                  }
                />
              </Row>
              <Row label="Motif">
                <Segmented
                  value={first(nodes, 'fillStyle')}
                  onChange={(fillStyle) => patchNodes({ fillStyle })}
                  options={[
                    { value: 'hachure', label: 'Hachures' },
                    { value: 'cross-hatch', label: 'Croisé' },
                    { value: 'solid', label: 'Plein' },
                    { value: 'dots', label: 'Points' },
                  ]}
                />
              </Row>
            </>
          )}
          <Row label="Texte">
            <Colors colors={STROKE_COLORS} value={first(nodes, 'textColor')} onChange={(textColor) => patchNodes({ textColor })} />
          </Row>
          <Row label="Animation">
            <Segmented
              value={first(nodes, 'animation')}
              onChange={(animation) => patchNodes({ animation })}
              options={[
                { value: 'none', label: 'Aucune' },
                { value: 'pulse', label: 'Pulsation' },
                { value: 'glow', label: 'Halo' },
                { value: 'blink', label: 'Clignote' },
              ]}
            />
          </Row>
          <Row label="Apparition">
            <Segmented value={first(nodes, 'reveal')} onChange={(r) => setReveal(r)} options={revealOptions} />
          </Row>
          {nodes.some((n) => n.reveal !== 'none') && (
            <Row label="Apparaît à">
              <div className="slider-auto">
                <button
                  className={`btn small ${first(nodes, 'revealDelay') == null ? 'active' : ''}`}
                  title="À l’arrivée du premier flux entrant"
                  onClick={() => patchNodes({ revealDelay: null })}
                >
                  Auto
                </button>
                <Slider
                  min={0}
                  max={30}
                  step={0.1}
                  unit=" s"
                  value={first(nodes, 'revealDelay') ?? 0}
                  onChange={(revealDelay) => patchNodes({ revealDelay }, true)}
                />
              </div>
            </Row>
          )}
          {nodes.some((n) => n.reveal !== 'none') && (
            <p className="muted">
              La forme apparaît à l’arrivée du premier flux entrant (mode séquence). Mettez en pause pour voir le contour des
              formes masquées.
            </p>
          )}
          {diagram.settings.sequence && nodes.some((n) => n.animation === 'pulse' || n.animation === 'glow') && (
            <p className="muted">En mode séquence, la pulsation et le halo se déclenchent à l’arrivée des flux entrants.</p>
          )}
        </Section>
      )}

      <Section title="Typographie">
        <Row label="Police">
          <Segmented
            value={first(nodes, 'fontFamily') ?? first(edges, 'fontFamily')}
            onChange={(fontFamily) => patchBoth({ fontFamily })}
            options={[
              { value: 'hand', label: <span style={{ fontFamily: 'Kalam' }}>Main</span> },
              { value: 'sans', label: <span style={{ fontFamily: 'Inter' }}>Sans</span> },
              { value: 'mono', label: <span style={{ fontFamily: 'JetBrains Mono' }}>Code</span> },
            ]}
          />
        </Row>
        <Row label="Taille">
          <Slider
            min={10}
            max={48}
            step={1}
            value={first(nodes, 'fontSize') ?? first(edges, 'fontSize') ?? 16}
            onChange={(fontSize) => patchBoth({ fontSize }, true)}
          />
        </Row>
      </Section>

      {edges.length > 0 && anim && (
        <>
          <Section title="Lien">
            <div className="button-row">
              <button className="btn small-outline" title="Échange source et cible (et le sens du flux) — Maj+R" onClick={reverseSelectedEdges}>
                ⇄ Inverser le lien
              </button>
              {edges.some((e) => !e.source.nodeId || !e.target.nodeId) && (
                <button className="btn small-outline" title="Rattache les extrémités libres aux formes à moins de 16 px" onClick={() => snapFreeEdges()}>
                  🧲 Raccrocher
                </button>
              )}
            </div>
            <Row label="Tracé">
              <Segmented
                value={first(edges, 'routing')}
                onChange={(routing) => patchEdges({ routing })}
                options={[
                  { value: 'straight', label: 'Droit' },
                  { value: 'curved', label: 'Courbe' },
                  { value: 'elbow', label: 'Coudé' },
                ]}
              />
            </Row>
            <Row label="Pointillés">
              <Segmented
                value={first(edges, 'strokeStyle')}
                onChange={(strokeStyle) => patchEdges({ strokeStyle })}
                options={[
                  { value: 'solid', label: '———' },
                  { value: 'dashed', label: '– – –' },
                  { value: 'dotted', label: '· · · ·' },
                ]}
              />
            </Row>
            <Row label="Flèches">
              <Segmented
                value={first(edges, 'arrowHeads')}
                onChange={(arrowHeads) => patchEdges({ arrowHeads })}
                options={[
                  { value: 'none', label: '—' },
                  { value: 'end', label: '→' },
                  { value: 'start', label: '←' },
                  { value: 'both', label: '↔' },
                ]}
              />
            </Row>
          </Section>

          <Section title="Animation du flux">
            <Row label="Effet">
              <Segmented
                value={anim.type}
                onChange={(type) => patchAnim({ type })}
                options={[
                  { value: 'none', label: 'Aucun' },
                  { value: 'flow', label: 'Tirets', title: 'Tirets qui défilent' },
                  { value: 'particles', label: 'Particules', title: 'Points qui circulent' },
                  { value: 'comet', label: 'Comète', title: 'Impulsion lumineuse' },
                  { value: 'draw', label: 'Tracé', title: 'Le lien se dessine progressivement' },
                ]}
              />
            </Row>
            {anim.type !== 'none' && (
              <>
                <Row label="Durée d’un parcours">
                  <Slider min={0.2} max={8} step={0.1} value={anim.duration} unit=" s" onChange={(duration) => patchAnim({ duration }, true)} />
                </Row>
                <Row label={diagram.settings.sequence ? 'Démarre à' : 'Délai'}>
                  <Slider min={0} max={20} step={0.1} value={anim.delay} unit=" s" onChange={(delay) => patchAnim({ delay }, true)} />
                </Row>
                {diagram.settings.sequence && (
                  <Row label="Pause supplémentaire avant ce flux">
                    <Slider
                      min={0}
                      max={10}
                      step={0.1}
                      value={anim.extraPause}
                      unit=" s"
                      onChange={(extraPause) =>
                        // Les flux suivants sont décalés d'autant
                        apply((d) =>
                          retime({
                            ...d,
                            edges: d.edges.map((e) =>
                              ids.has(e.id)
                                ? {
                                    ...e,
                                    animation: {
                                      ...e.animation,
                                      extraPause,
                                      // En ordre manuel, la pause est appliquée à l'étape entière par le re-minutage
                                      delay: d.settings.manualOrder
                                        ? e.animation.delay
                                        : Math.max(0, e.animation.delay + extraPause - e.animation.extraPause),
                                    },
                                  }
                                : e,
                            ),
                          }),
                        )
                      }
                    />
                  </Row>
                )}
                <Row label="Sens">
                  <Segmented
                    value={anim.reverse}
                    onChange={(reverse) => patchAnim({ reverse })}
                    options={[
                      { value: false, label: 'Source → cible' },
                      { value: true, label: 'Inverse' },
                    ]}
                  />
                </Row>
                <Row label="Apparition">
                  <Segmented
                    value={first(edges, 'reveal')}
                    onChange={(reveal) =>
                      commit((d) => ({
                        ...d,
                        settings: reveal ? { ...d.settings, sequence: true } : d.settings,
                        edges: d.edges.map((e) => (ids.has(e.id) ? { ...e, reveal } : e)),
                      }))
                    }
                    options={[
                      { value: false, label: 'Toujours' },
                      { value: true, label: 'Au démarrage du flux', title: 'Le lien apparaît à son délai (mode séquence)' },
                    ]}
                  />
                </Row>
                {anim.type === 'particles' && (
                  <>
                    <Row label="Particules">
                      <Slider min={1} max={12} step={1} value={anim.particleCount} onChange={(particleCount) => patchAnim({ particleCount }, true)} />
                    </Row>
                    <Row label="Taille">
                      <Slider min={2} max={12} step={0.5} value={anim.particleSize} onChange={(particleSize) => patchAnim({ particleSize }, true)} />
                    </Row>
                  </>
                )}
                <Row label="Couleur du flux">
                  <div className="colors">
                    <button className={`swatch auto ${anim.color === null ? 'active' : ''}`} title="Couleur du trait" onClick={() => patchAnim({ color: null })}>
                      A
                    </button>
                    <Colors colors={STROKE_COLORS.slice(1)} value={anim.color ?? undefined} onChange={(color) => patchAnim({ color })} />
                  </div>
                </Row>
              </>
            )}
          </Section>
        </>
      )}

      <div className="actions">
        <button className="icon-btn" title="Dupliquer — Ctrl+D" onClick={duplicateSelected}>
          {icons.copy}
        </button>
        <button className="icon-btn danger" title="Supprimer — Suppr" onClick={deleteSelected}>
          {icons.trash}
        </button>
      </div>
    </div>
  );
}
