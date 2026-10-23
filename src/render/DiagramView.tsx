import { memo, useMemo, type ReactNode } from 'react';
import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';
import {
  arrivalWindows,
  discreteVisibility,
  edgeWindow,
  linearKeys,
  pulseKeys,
  REVEAL_DURATION,
  revealTimes,
  sequenceCycle,
  type AnimWindow,
} from '../animation';
import { FONT_STACKS } from '../defaults';
import { arrowHeadPath, center, edgeGeometry, nodeMap, type EdgeGeometry } from '../geometry';
import { measureText } from '../text';
import type { Diagram, DiagramSettings, EdgeElement, FontFamily, NodeElement, Point } from '../types';

const gen = rough.generator();

const hasFill = (n: NodeElement) => n.fillStyle !== 'none' && n.fillColor !== 'transparent';

function roughPaths(drawable: ReturnType<typeof gen.rectangle>, keyPrefix: string): ReactNode[] {
  return gen.toPaths(drawable).map((p, i) => (
    <path
      key={`${keyPrefix}${i}`}
      d={p.d}
      stroke={p.stroke}
      strokeWidth={p.strokeWidth}
      fill={p.fill ?? 'none'}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ));
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number) {
  return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

const cornerRadius = (n: NodeElement) => Math.min(18, n.height / 4, n.width / 4);

/** Contour net (sans effet main levée) : utilisé pour le mode roughness 0 et les halos. */
export function plainShape(n: NodeElement, props: React.SVGProps<SVGElement>): ReactNode {
  const { x, y, width: w, height: h } = n;
  const p = props as React.SVGProps<SVGPathElement>;
  switch (n.shape) {
    case 'ellipse':
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...(props as React.SVGProps<SVGEllipseElement>)} />;
    case 'diamond':
      return <path d={`M${x + w / 2} ${y} L${x + w} ${y + h / 2} L${x + w / 2} ${y + h} L${x} ${y + h / 2} Z`} {...p} />;
    case 'rounded':
      return <path d={roundedRectPath(x, y, w, h, cornerRadius(n))} {...p} />;
    default:
      return <path d={`M${x} ${y} H${x + w} V${y + h} H${x} Z`} {...p} />;
  }
}

function NodeShape({ n }: { n: NodeElement }) {
  return useMemo(() => {
    if (n.shape === 'text') return null;
    if (n.roughness === 0) {
      return plainShape(n, {
        stroke: n.strokeColor,
        strokeWidth: n.strokeWidth,
        fill: hasFill(n) ? n.fillColor : 'none',
        strokeLinejoin: 'round',
      });
    }
    const opts: Options = {
      seed: n.seed,
      roughness: n.roughness,
      stroke: n.strokeColor,
      strokeWidth: n.strokeWidth,
      fill: hasFill(n) ? n.fillColor : undefined,
      fillStyle: hasFill(n) ? n.fillStyle : undefined,
      fillWeight: Math.max(1, n.strokeWidth / 2),
      hachureGap: 7,
      preserveVertices: true,
    };
    const { x, y, width: w, height: h } = n;
    let drawable;
    switch (n.shape) {
      case 'ellipse':
        drawable = gen.ellipse(x + w / 2, y + h / 2, w, h, opts);
        break;
      case 'diamond':
        drawable = gen.polygon(
          [
            [x + w / 2, y],
            [x + w, y + h / 2],
            [x + w / 2, y + h],
            [x, y + h / 2],
          ],
          opts,
        );
        break;
      case 'rounded':
        drawable = gen.path(roundedRectPath(x, y, w, h, cornerRadius(n)), opts);
        break;
      default:
        drawable = gen.rectangle(x, y, w, h, opts);
    }
    return <g>{roughPaths(drawable, 's')}</g>;
  }, [n]);
}

export function TextLabel(props: {
  x: number;
  y: number;
  text: string;
  fontFamily: FontFamily;
  fontSize: number;
  color: string;
}) {
  const lines = props.text.split('\n');
  const lh = props.fontSize * 1.25;
  const y0 = props.y - ((lines.length - 1) * lh) / 2;
  return (
    <text
      x={props.x}
      y={props.y}
      fontFamily={FONT_STACKS[props.fontFamily]}
      fontSize={props.fontSize}
      fill={props.color}
      textAnchor="middle"
      dominantBaseline="central"
      style={{ userSelect: 'none' }}
    >
      {lines.map((l, i) => (
        <tspan key={i} x={props.x} y={y0 + i * lh} dominantBaseline="central">
          {l || ' '}
        </tspan>
      ))}
    </text>
  );
}

/** Masque son contenu jusqu'à `at` (secondes dans le cycle), puis le fait apparaître (fondu, ou fondu + zoom). */
function Reveal({ at, cycle, pop, c, children }: { at: number; cycle: number; pop: boolean; c: Point; children: ReactNode }) {
  const s = Math.min(1, at / cycle);
  const e = Math.min(1, (at + REVEAL_DURATION) / cycle);
  const fade = linearKeys(0, 0, 1, 1, s, e);
  const scale = linearKeys(0.5, 0.5, 1, 1, s, e);
  return (
    <g key={`${at}-${cycle}-${pop}`} opacity={0}>
      <animate attributeName="opacity" values={fade.values} keyTimes={fade.keyTimes} dur={`${cycle}s`} repeatCount="indefinite" />
      {pop ? (
        <g transform={`translate(${c.x} ${c.y})`}>
          <g>
            <animateTransform
              attributeName="transform"
              type="scale"
              values={scale.values}
              keyTimes={scale.keyTimes}
              dur={`${cycle}s`}
              repeatCount="indefinite"
            />
            <g transform={`translate(${-c.x} ${-c.y})`}>{children}</g>
          </g>
        </g>
      ) : (
        children
      )}
    </g>
  );
}

interface NodeViewProps {
  node: NodeElement;
  /** Fenêtres d'arrivée de flux (mode séquence) */
  arrivals: [number, number][] | null;
  cycle: number;
  hideLabel: boolean;
  /** Instant d'apparition (mode séquence), null = toujours visible */
  revealAt: number | null;
}

export const NodeView = memo(function NodeView({ node, arrivals, cycle, hideLabel, revealAt }: NodeViewProps) {
  const inner = <NodeAnimated node={node} arrivals={arrivals} cycle={cycle} hideLabel={hideLabel} />;
  return (
    <g data-id={node.id}>
      {revealAt !== null ? (
        <Reveal at={revealAt} cycle={cycle} pop={node.reveal === 'pop'} c={center(node)}>
          {inner}
        </Reveal>
      ) : (
        inner
      )}
    </g>
  );
});

function NodeAnimated({ node, arrivals, cycle, hideLabel }: Omit<NodeViewProps, 'revealAt'>) {
  const c = center(node);
  const body = (
    <>
      <NodeShape n={node} />
      {node.label && !hideLabel && (
        <TextLabel x={c.x} y={c.y} text={node.label} fontFamily={node.fontFamily} fontSize={node.fontSize} color={node.textColor} />
      )}
    </>
  );

  const seqKeys = arrivals && arrivals.length ? arrivals : null;
  const animKey = `${node.animation}-${cycle}-${JSON.stringify(seqKeys)}`;

  switch (node.animation) {
    case 'pulse': {
      const keys = seqKeys ? pulseKeys(seqKeys, 1, 1.08) : null;
      return (
        <>
          <g transform={`translate(${c.x} ${c.y})`}>
            <g key={animKey}>
              <animateTransform
                attributeName="transform"
                type="scale"
                dur={keys ? `${cycle}s` : '1.6s'}
                values={keys ? keys.values : '1;1.06;1'}
                keyTimes={keys ? keys.keyTimes : '0;0.5;1'}
                repeatCount="indefinite"
              />
              <g transform={`translate(${-c.x} ${-c.y})`}>{body}</g>
            </g>
          </g>
        </>
      );
    }
    case 'glow': {
      const keys = seqKeys ? pulseKeys(seqKeys, 0, 0.9) : null;
      return (
        <>
          <g key={animKey} opacity={0}>
            {plainShape(node, {
              stroke: node.strokeColor === '#1e1e1e' ? '#fab005' : node.strokeColor,
              strokeWidth: 10,
              fill: 'none',
              filter: 'url(#af-glow)',
            })}
            <animate
              attributeName="opacity"
              dur={keys ? `${cycle}s` : '2s'}
              values={keys ? keys.values : '0;0.9;0'}
              keyTimes={keys ? keys.keyTimes : '0;0.5;1'}
              repeatCount="indefinite"
            />
          </g>
          {body}
        </>
      );
    }
    case 'blink':
      return (
        <>
          <g>
            <animate attributeName="opacity" dur="1.2s" values="1;0.35;1" repeatCount="indefinite" />
            {body}
          </g>
        </>
      );
    default:
      return body;
  }
}

function dashArray(e: EdgeElement): string | undefined {
  const sw = e.strokeWidth;
  if (e.strokeStyle === 'dashed') return `${sw * 4} ${sw * 3}`;
  if (e.strokeStyle === 'dotted') return `${sw * 0.5} ${sw * 2.5}`;
  return undefined;
}

function EdgeLine({ edge, geo }: { edge: EdgeElement; geo: EdgeGeometry }) {
  const dash = dashArray(edge);
  return useMemo(() => {
    if (edge.roughness === 0) {
      return (
        <path
          d={geo.d}
          stroke={edge.strokeColor}
          strokeWidth={edge.strokeWidth}
          fill="none"
          strokeDasharray={dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    const opts: Options = {
      seed: edge.seed,
      roughness: edge.roughness * 0.8,
      stroke: edge.strokeColor,
      strokeWidth: edge.strokeWidth,
      strokeLineDash: dash?.split(' ').map(Number),
      preserveVertices: true,
      disableMultiStroke: !!dash,
    };
    const pts = geo.points.map((p) => [p.x, p.y] as [number, number]);
    const drawable = edge.routing === 'curved' ? gen.curve(pts, opts) : gen.linearPath(pts, opts);
    return <g>{roughPaths(drawable, 'l')}</g>;
  }, [edge, geo, dash]);
}

function visibilityAnim(keys: Keys | number, dur: number, begin = 0): ReactNode {
  if (typeof keys === 'number') return null;
  return (
    <animate
      attributeName="opacity"
      calcMode="discrete"
      values={keys.values}
      keyTimes={keys.keyTimes}
      dur={`${dur}s`}
      begin={`${begin}s`}
      repeatCount="indefinite"
    />
  );
}
type Keys = { values: string; keyTimes: string };
const staticOpacity = (keys: Keys | number) => (typeof keys === 'number' ? keys : 0);

function EdgeAnimationView({
  edge,
  geo,
  w,
  sequence,
}: {
  edge: EdgeElement;
  geo: EdgeGeometry;
  w: AnimWindow;
  sequence: boolean;
}) {
  const a = edge.animation;
  const color = a.color ?? edge.strokeColor;
  const sw = edge.strokeWidth;
  const len = Math.max(1, geo.length);
  const d = a.reverse ? geo.dRev : geo.d;
  const pathId = `af-p-${edge.id}`;
  const key = `${a.type}|${a.duration}|${a.delay}|${a.reverse}|${a.particleCount}|${w.dur}|${Math.round(len)}|${d}`;

  switch (a.type) {
    case 'flow': {
      const dashL = Math.max(6, sw * 3);
      const gapL = dashL * 1.3;
      const period = dashL + gapL;
      const travel = Math.max(1, Math.round(len / period)) * period;
      // Visible seulement pendant sa fenêtre en séquence, ou hors du temps de repos en boucle
      const vis = sequence || w.end < 1 ? discreteVisibility([[w.start, w.end]]) : 1;
      return (
        <path
          key={key}
          d={d}
          stroke={color}
          strokeWidth={sw + 0.5}
          fill="none"
          strokeDasharray={`${dashL} ${gapL}`}
          strokeLinecap="round"
          opacity={staticOpacity(vis)}
        >
          <animate
            attributeName="stroke-dashoffset"
            values={`0;${-travel}`}
            dur={`${(a.duration * travel) / len}s`}
            repeatCount="indefinite"
          />
          {visibilityAnim(vis, w.dur, w.begin)}
        </path>
      );
    }
    case 'comet': {
      const seg = Math.min(len * 0.35, 40 + sw * 6);
      const k = linearKeys(seg, seg, -len, -len, w.start, w.end);
      return (
        <path
          key={key}
          d={d}
          stroke={color}
          strokeWidth={sw + 2.5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${seg} ${len + seg}`}
          strokeDashoffset={seg}
          filter="url(#af-soft)"
        >
          <animate
            attributeName="stroke-dashoffset"
            values={k.values}
            keyTimes={k.keyTimes}
            calcMode="linear"
            dur={`${w.dur}s`}
            begin={`${w.begin}s`}
            repeatCount="indefinite"
          />
        </path>
      );
    }
    case 'draw': {
      const k = linearKeys(len, len, 0, 0, w.start, w.end);
      return (
        <path
          key={key}
          d={d}
          stroke={color}
          strokeWidth={sw}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${len} ${len}`}
          strokeDashoffset={len}
        >
          <animate
            attributeName="stroke-dashoffset"
            values={k.values}
            keyTimes={k.keyTimes}
            calcMode="linear"
            dur={`${w.dur}s`}
            begin={`${w.begin}s`}
            repeatCount="indefinite"
          />
        </path>
      );
    }
    case 'particles': {
      const n = Math.max(1, Math.min(12, Math.round(a.particleCount)));
      const r = a.particleSize;
      const circles: ReactNode[] = [];
      if (!sequence && w.end >= 1) {
        // Boucle sans repos : flux continu de particules régulièrement espacées
        for (let i = 0; i < n; i++) {
          const b = a.delay - (i * a.duration) / n;
          circles.push(
            <circle key={i} r={r} fill={color} opacity={b > 0 ? 0 : 1} filter="url(#af-soft)">
              {b > 0 && <set attributeName="opacity" to="1" begin={`${b}s`} />}
              <animateMotion dur={`${a.duration}s`} begin={`${b}s`} repeatCount="indefinite">
                <mpath href={`#${pathId}`} />
              </animateMotion>
            </circle>,
          );
        }
      } else {
        // Séquence, ou boucle avec repos : un train de particules par fenêtre active
        const T = w.dur;
        const base = sequence ? a.delay : 0;
        const travel = n === 1 ? a.duration : a.duration * 0.7;
        const stagger = n === 1 ? 0 : (a.duration * 0.3) / (n - 1);
        for (let i = 0; i < n; i++) {
          const s = Math.min(1, (base + i * stagger) / T);
          const e = Math.min(1, (base + i * stagger + travel) / T);
          const kp = linearKeys(0, 0, 1, 1, s, e);
          const vis = discreteVisibility([[s, e]]);
          circles.push(
            <circle key={i} r={r} fill={color} opacity={staticOpacity(vis)} filter="url(#af-soft)">
              <animateMotion
                dur={`${T}s`}
                begin={`${w.begin}s`}
                repeatCount="indefinite"
                calcMode="linear"
                keyPoints={kp.values}
                keyTimes={kp.keyTimes}
              >
                <mpath href={`#${pathId}`} />
              </animateMotion>
              {visibilityAnim(vis, T, w.begin)}
            </circle>,
          );
        }
      }
      return (
        <g key={key}>
          <path id={pathId} d={d} fill="none" stroke="none" />
          {circles}
        </g>
      );
    }
    default:
      return null;
  }
}

interface EdgeViewProps {
  edge: EdgeElement;
  geo: EdgeGeometry;
  settings: DiagramSettings;
  cycle: number;
  hideLabel: boolean;
  revealAt: number | null;
}

export const EdgeView = memo(function EdgeView({ edge, geo, settings, cycle, hideLabel, revealAt }: EdgeViewProps) {
  const a = edge.animation;
  const w = edgeWindow(edge, settings, cycle);
  const animated = a.type !== 'none';
  const baseOpacity = !animated ? 1 : a.type === 'draw' ? 0.12 : a.type === 'flow' && !settings.sequence ? 0.25 : 1;
  const size = 10 + edge.strokeWidth * 2;
  const heads: string[] = [];
  if (edge.arrowHeads === 'end' || edge.arrowHeads === 'both') heads.push(arrowHeadPath(geo.end, geo.endDir, size));
  if (edge.arrowHeads === 'start' || edge.arrowHeads === 'both') heads.push(arrowHeadPath(geo.start, geo.startDir, size));
  const headVis = a.type === 'draw' ? discreteVisibility([[w.end, 1]]) : 1;

  const labelSize = edge.label ? measureText(edge.label, edge.fontFamily, edge.fontSize) : { width: 0, height: 0 };
  const labelW = edge.label ? labelSize.width + 12 : 0;
  const labelH = edge.label ? labelSize.height + 6 : 0;

  const content = (
    <>
      <g opacity={baseOpacity}>
        <EdgeLine edge={edge} geo={geo} />
      </g>
      {animated && <EdgeAnimationView edge={edge} geo={geo} w={w} sequence={settings.sequence} />}
      {heads.length > 0 && (
        <g key={`h-${a.type}-${w.dur}-${w.end}-${w.begin}`} opacity={staticOpacity(headVis)}>
          {heads.map((h, i) => (
            <path
              key={i}
              d={h}
              stroke={edge.strokeColor}
              strokeWidth={edge.strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {visibilityAnim(headVis, w.dur, w.begin)}
        </g>
      )}
      {edge.label && !hideLabel && (
        <g>
          <rect
            x={geo.mid.x - labelW / 2}
            y={geo.mid.y - labelH / 2}
            width={labelW}
            height={labelH}
            rx={4}
            fill={settings.background}
            opacity={0.9}
          />
          <TextLabel
            x={geo.mid.x}
            y={geo.mid.y}
            text={edge.label}
            fontFamily={edge.fontFamily}
            fontSize={edge.fontSize}
            color={edge.strokeColor}
          />
        </g>
      )}
    </>
  );
  return (
    <g data-id={edge.id}>
      {revealAt !== null ? (
        <Reveal at={revealAt} cycle={cycle} pop={false} c={geo.mid}>
          {content}
        </Reveal>
      ) : (
        content
      )}
    </g>
  );
});

export function SvgDefs() {
  return (
    <defs>
      <filter id="af-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <filter id="af-soft" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

/** Contenu exportable du diagramme (ce qui est cloné pour l'export SVG). */
export const DiagramContent = memo(function DiagramContent({
  diagram,
  geometries,
  editingId,
}: {
  diagram: Diagram;
  geometries: Map<string, EdgeGeometry>;
  editingId: string | null;
}) {
  const cycle = diagram.settings.sequence ? sequenceCycle(diagram) : 0;
  const reveal = diagram.settings.sequence ? revealTimes(diagram) : null;
  return (
    <g className="af-content">
      <SvgDefs />
      {diagram.edges.map((e) => (
        <EdgeView
          key={e.id}
          edge={e}
          geo={geometries.get(e.id)!}
          settings={diagram.settings}
          cycle={cycle}
          hideLabel={editingId === e.id}
          revealAt={reveal?.edges.get(e.id) ?? null}
        />
      ))}
      {diagram.nodes.map((n) => (
        <NodeView
          key={n.id}
          node={n}
          cycle={cycle}
          arrivals={diagram.settings.sequence ? arrivalWindows(diagram, n.id, cycle) : null}
          hideLabel={editingId === n.id}
          revealAt={reveal?.nodes.get(n.id) ?? null}
        />
      ))}
    </g>
  );
});

export function computeGeometries(d: Diagram): Map<string, EdgeGeometry> {
  const nodes = nodeMap(d.nodes);
  return new Map(d.edges.map((e) => [e.id, edgeGeometry(e, nodes)]));
}
