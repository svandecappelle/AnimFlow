import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { CAMERA_MAX_ZOOM, cameraAt, cameraKeyframes, fitViewport, leftInset, visibleArea } from '../camera';
import { updateCursor } from '../collab';
import { createEdge, createNode, DEFAULT_SIZES, FONT_STACKS } from '../defaults';
import { center, distanceToPolyline, nodeContains, nodeMap, type EdgeGeometry } from '../geometry';
import { computeGeometries, DiagramContent } from '../render/DiagramView';
import { setCanvasSvg, useStore, type Peer, type Viewport } from '../store';
import { measureText } from '../text';
import type { EdgeElement, EdgeEnd, NodeElement, Point, ShapeType } from '../types';

type Handle = 'nw' | 'ne' | 'sw' | 'se';

type Drag =
  | { kind: 'pan'; startClient: Point; orig: Viewport }
  | { kind: 'move'; start: Point; moved: boolean; nodes: Map<string, Point>; edges: Map<string, { source: EdgeEnd; target: EdgeEnd }> }
  | { kind: 'resize'; id: string; handle: Handle; orig: NodeElement }
  | { kind: 'endpoint'; id: string; which: 'source' | 'target'; hover?: string }
  | { kind: 'marquee'; start: Point; current: Point; base: string[] }
  | { kind: 'create'; shape: ShapeType; start: Point; current: Point }
  | { kind: 'arrow'; source: EdgeEnd; current: Point; hover?: string };

const SELECTION_COLOR = '#6965db';
const SHAPE_TOOLS = ['rectangle', 'rounded', 'ellipse', 'diamond'] as const;

/** Une action manuelle sur la vue ou le schéma met la caméra de suivi en pause. */
const suspendCamera = () => useStore.getState().setCameraSuspended(true);

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const diagram = useStore((s) => s.diagram);
  const viewport = useStore((s) => s.viewport);
  const tool = useStore((s) => s.tool);
  const selectedIds = useStore((s) => s.selectedIds);
  const editingId = useStore((s) => s.editingId);
  const playing = useStore((s) => s.playing);
  const restartToken = useStore((s) => s.restartToken);
  const cameraSuspended = useStore((s) => s.cameraSuspended);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const peers = useStore((s) => s.peers);
  const { select, setViewport, pushHistory, apply, commit, setTool, setEditing } = useStore.getState();

  const [drag, setDrag] = useState<Drag | null>(null);
  const spaceDown = useRef(false);

  const nodesById = useMemo(() => nodeMap(diagram.nodes), [diagram.nodes]);
  const geometries = useMemo(() => computeGeometries(diagram), [diagram]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    setCanvasSvg(svgRef.current);
    return () => setCanvasSvg(null);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (playing) svg.unpauseAnimations();
    else svg.pauseAnimations();
  }, [playing]);

  useEffect(() => {
    if (restartToken) svgRef.current?.setCurrentTime(0);
  }, [restartToken]);

  // Caméra de suivi : cadre les éléments en cours d'animation (mode séquence, pendant la lecture)
  const cameraOn = playing && diagram.settings.sequence && diagram.settings.camera !== 'off' && !cameraSuspended;
  useEffect(() => {
    const svg = svgRef.current;
    if (!cameraOn || !svg) return;
    const rect = svg.getBoundingClientRect();
    const inset = leftInset(useStore.getState().sidebarOpen);
    const area = visibleArea(rect, inset);
    const keys = cameraKeyframes(diagram, area);
    if (!keys.length) return;
    let raf = 0;
    const tick = () => {
      const target = cameraAt(keys, svg.getCurrentTime());
      if (target) {
        const goal = fitViewport(target, rect, CAMERA_MAX_ZOOM, inset);
        const cur = useStore.getState().viewport;
        // Lissage : rattrape la cible sans à-coup (y compris quand on réactive la caméra)
        const k = 0.18;
        const next = { x: cur.x + (goal.x - cur.x) * k, y: cur.y + (goal.y - cur.y) * k, zoom: cur.zoom + (goal.zoom - cur.zoom) * k };
        if (Math.abs(next.x - cur.x) + Math.abs(next.y - cur.y) + Math.abs(next.zoom - cur.zoom) * 100 > 0.05) setViewport(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cameraOn, diagram, setViewport, sidebarOpen]);

  // Molette : défilement ; Ctrl/pincement : zoom centré sur le pointeur
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      suspendCamera();
      const vp = useStore.getState().viewport;
      if (e.ctrlKey || e.metaKey) {
        const rect = svg.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const zoom = Math.min(5, Math.max(0.1, vp.zoom * Math.exp(-e.deltaY * 0.01)));
        setViewport({ zoom, x: sx - ((sx - vp.x) * zoom) / vp.zoom, y: sy - ((sy - vp.y) * zoom) / vp.zoom });
      } else {
        setViewport({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY });
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [setViewport]);

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        spaceDown.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - viewport.x) / viewport.zoom, y: (clientY - rect.top - viewport.y) / viewport.zoom };
  };

  const tol = 6 / viewport.zoom;

  /** `hollowByBorder` : une forme sans remplissage ne se sélectionne que par son contour ou son libellé (comme Excalidraw). */
  const nodeAt = (p: Point, exclude?: string, hollowByBorder = false): NodeElement | undefined => {
    for (let i = diagram.nodes.length - 1; i >= 0; i--) {
      const n = diagram.nodes[i];
      if (n.id === exclude || !nodeContains(n, p, tol)) continue;
      const hollow = n.shape !== 'text' && (n.fillStyle === 'none' || n.fillColor === 'transparent');
      if (hollowByBorder && hollow && nodeContains(n, p, -2 * tol)) {
        const c = center(n);
        const lines = n.label.split('\n');
        const onLabel =
          !!n.label &&
          Math.abs(p.x - c.x) < (Math.max(...lines.map((l) => l.length)) * n.fontSize) / 3 + 8 &&
          Math.abs(p.y - c.y) < lines.length * n.fontSize * 0.65;
        if (!onLabel) continue;
      }
      return n;
    }
    return undefined;
  };

  const edgeAt = (p: Point): EdgeElement | undefined => {
    for (let i = diagram.edges.length - 1; i >= 0; i--) {
      const e = diagram.edges[i];
      const g = geometries.get(e.id)!;
      if (distanceToPolyline(p, g.points) <= tol + e.strokeWidth) return e;
      if (e.label && Math.abs(p.x - g.mid.x) < e.label.length * e.fontSize * 0.3 + 6 && Math.abs(p.y - g.mid.y) < e.fontSize) return e;
    }
    return undefined;
  };

  const singleNode = selectedIds.length === 1 ? nodesById.get(selectedIds[0]) : undefined;
  const singleEdge = selectedIds.length === 1 ? diagram.edges.find((e) => e.id === selectedIds[0]) : undefined;

  const handlePoints = (n: NodeElement): Record<Handle, Point> => {
    const pad = 6 / viewport.zoom;
    return {
      nw: { x: n.x - pad, y: n.y - pad },
      ne: { x: n.x + n.width + pad, y: n.y - pad },
      sw: { x: n.x - pad, y: n.y + n.height + pad },
      se: { x: n.x + n.width + pad, y: n.y + n.height + pad },
    };
  };

  const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= 9 / viewport.zoom;

  const startEditing = (id: string) => {
    select([id]);
    setEditing(id);
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (editingId) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    if (e.button === 1 || tool === 'hand' || spaceDown.current) {
      setDrag({ kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, orig: viewport });
      suspendCamera();
      return;
    }
    if (e.button !== 0) return;
    const p = toWorld(e.clientX, e.clientY);

    if (tool === 'select') {
      if (singleNode && singleNode.shape !== 'text') {
        const hp = handlePoints(singleNode);
        const h = (Object.keys(hp) as Handle[]).find((k) => near(hp[k], p));
        if (h) {
          pushHistory();
          suspendCamera();
          setDrag({ kind: 'resize', id: singleNode.id, handle: h, orig: singleNode });
          return;
        }
      }
      if (singleEdge) {
        const g = geometries.get(singleEdge.id)!;
        const which = near(g.end, p) ? 'target' : near(g.start, p) ? 'source' : null;
        if (which) {
          pushHistory();
          suspendCamera();
          setDrag({ kind: 'endpoint', id: singleEdge.id, which });
          return;
        }
      }
      const hit = nodeAt(p, undefined, true) ?? edgeAt(p);
      if (hit) {
        let ids = selectedIds;
        if (e.shiftKey) ids = selected.has(hit.id) ? ids.filter((i) => i !== hit.id) : [...ids, hit.id];
        else if (!selected.has(hit.id)) ids = [hit.id];
        select(ids);
        const idSet = new Set(ids);
        setDrag({
          kind: 'move',
          start: p,
          moved: false,
          nodes: new Map(diagram.nodes.filter((n) => idSet.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }])),
          edges: new Map(diagram.edges.filter((ed) => idSet.has(ed.id)).map((ed) => [ed.id, { source: ed.source, target: ed.target }])),
        });
      } else {
        const base = e.shiftKey ? selectedIds : [];
        select(base);
        setDrag({ kind: 'marquee', start: p, current: p, base });
      }
      return;
    }

    if ((SHAPE_TOOLS as readonly string[]).includes(tool)) {
      setDrag({ kind: 'create', shape: tool as ShapeType, start: p, current: p });
      return;
    }

    if (tool === 'arrow') {
      const n = nodeAt(p);
      setDrag({ kind: 'arrow', source: n ? { nodeId: n.id, ...center(n) } : p, current: p });
      return;
    }

    if (tool === 'text') {
      const node = createNode('text', p.x - 60, p.y - 16);
      commit((d) => ({ ...d, nodes: [...d.nodes, node] }));
      setTool('select');
      startEditing(node.id);
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toWorld(e.clientX, e.clientY);
    updateCursor(p);
    if (!drag) return;
    switch (drag.kind) {
      case 'pan':
        setViewport({ ...drag.orig, x: drag.orig.x + e.clientX - drag.startClient.x, y: drag.orig.y + e.clientY - drag.startClient.y });
        break;
      case 'move': {
        let dx = p.x - drag.start.x;
        let dy = p.y - drag.start.y;
        if (!drag.moved) {
          if (Math.hypot(dx, dy) * viewport.zoom < 3) return;
          pushHistory();
          suspendCamera();
          setDrag({ ...drag, moved: true });
        }
        if (e.altKey) {
          // Alt : aimantation sur une grille de 20 px
          const first = drag.nodes.values().next().value;
          if (first) {
            dx = Math.round((first.x + dx) / 20) * 20 - first.x;
            dy = Math.round((first.y + dy) / 20) * 20 - first.y;
          }
        }
        apply((d) => ({
          ...d,
          nodes: d.nodes.map((n) => {
            const o = drag.nodes.get(n.id);
            return o ? { ...n, x: o.x + dx, y: o.y + dy } : n;
          }),
          edges: d.edges.map((ed) => {
            const o = drag.edges.get(ed.id);
            if (!o) return ed;
            const mv = (end: EdgeEnd) => (end.nodeId ? end : { x: end.x + dx, y: end.y + dy });
            return { ...ed, source: mv(o.source), target: mv(o.target) };
          }),
        }));
        break;
      }
      case 'resize': {
        const o = drag.orig;
        let x1 = o.x;
        let y1 = o.y;
        let x2 = o.x + o.width;
        let y2 = o.y + o.height;
        if (drag.handle.includes('w')) x1 = p.x;
        if (drag.handle.includes('e')) x2 = p.x;
        if (drag.handle.includes('n')) y1 = p.y;
        if (drag.handle.includes('s')) y2 = p.y;
        if (e.shiftKey) {
          // Maj : conserve les proportions
          const ratio = o.width / o.height;
          const w = Math.abs(x2 - x1);
          const h = w / ratio;
          if (drag.handle.includes('n')) y1 = y2 - h * Math.sign(y2 - y1 || 1);
          else y2 = y1 + h * Math.sign(y2 - y1 || 1);
        }
        const nx = Math.min(x1, x2);
        const ny = Math.min(y1, y2);
        const nw = Math.max(20, Math.abs(x2 - x1));
        const nh = Math.max(20, Math.abs(y2 - y1));
        apply((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === drag.id ? { ...n, x: nx, y: ny, width: nw, height: nh } : n)) }));
        break;
      }
      case 'endpoint': {
        const edge = diagram.edges.find((ed) => ed.id === drag.id)!;
        const other = drag.which === 'source' ? edge.target.nodeId : edge.source.nodeId;
        const n = nodeAt(p, other);
        const end: EdgeEnd = n ? { nodeId: n.id, ...center(n) } : p;
        apply((d) => ({ ...d, edges: d.edges.map((ed) => (ed.id === drag.id ? { ...ed, [drag.which]: end } : ed)) }));
        setDrag({ ...drag, hover: n?.id });
        break;
      }
      case 'marquee': {
        const minX = Math.min(drag.start.x, p.x);
        const maxX = Math.max(drag.start.x, p.x);
        const minY = Math.min(drag.start.y, p.y);
        const maxY = Math.max(drag.start.y, p.y);
        const inside = (q: Point) => q.x >= minX && q.x <= maxX && q.y >= minY && q.y <= maxY;
        const ids = [
          ...diagram.nodes.filter((n) => inside({ x: n.x, y: n.y }) && inside({ x: n.x + n.width, y: n.y + n.height })).map((n) => n.id),
          ...diagram.edges.filter((ed) => geometries.get(ed.id)!.points.every(inside)).map((ed) => ed.id),
        ];
        select([...new Set([...drag.base, ...ids])]);
        setDrag({ ...drag, current: p });
        break;
      }
      case 'create':
        setDrag({ ...drag, current: p });
        break;
      case 'arrow':
        setDrag({ ...drag, current: p, hover: nodeAt(p, drag.source.nodeId)?.id });
        break;
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === 'create') {
      let w = Math.abs(drag.current.x - drag.start.x);
      let h = Math.abs(drag.current.y - drag.start.y);
      let x = Math.min(drag.start.x, drag.current.x);
      let y = Math.min(drag.start.y, drag.current.y);
      if (w * viewport.zoom < 8 && h * viewport.zoom < 8) {
        [w, h] = DEFAULT_SIZES[drag.shape];
        x = drag.start.x - w / 2;
        y = drag.start.y - h / 2;
      }
      const node = createNode(drag.shape, x, y, Math.max(20, w), Math.max(20, h));
      commit((d) => ({ ...d, nodes: [...d.nodes, node] }));
      select([node.id]);
      setTool('select');
    } else if (drag.kind === 'arrow') {
      const target = drag.hover ? nodesById.get(drag.hover) : undefined;
      const srcPoint = drag.source.nodeId ? center(nodesById.get(drag.source.nodeId)!) : drag.source;
      const long = Math.hypot(drag.current.x - srcPoint.x, drag.current.y - srcPoint.y) * viewport.zoom > 12;
      if (target || (long && !nodeAt(drag.current))) {
        const edge = createEdge(drag.source, target ? { nodeId: target.id, ...center(target) } : drag.current);
        commit((d) => ({ ...d, edges: [...d.edges, edge] }));
        select([edge.id]);
      }
      setTool('select');
    }
    setDrag(null);
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'select') return;
    const p = toWorld(e.clientX, e.clientY);
    const hit = nodeAt(p, undefined, true) ?? edgeAt(p);
    if (hit) {
      startEditing(hit.id);
      return;
    }
    const node = createNode('text', p.x - 60, p.y - 16);
    commit((d) => ({ ...d, nodes: [...d.nodes, node] }));
    startEditing(node.id);
  };

  const cursor =
    drag?.kind === 'pan' ? 'grabbing' : tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';

  const gridSize = 20 * viewport.zoom;

  return (
    <div
      className="canvas-container"
      style={{
        background: diagram.settings.background,
        backgroundImage: `radial-gradient(circle, ${diagram.settings.background === '#1e1e2e' ? '#ffffff22' : '#00000018'} 1px, transparent 1px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
    >
      <svg
        ref={svgRef}
        className="canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => updateCursor(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          <DiagramContent diagram={diagram} geometries={geometries} editingId={editingId} />
          <SelectionLayer
            selected={selected}
            nodes={diagram.nodes}
            edges={diagram.edges}
            geometries={geometries}
            zoom={viewport.zoom}
            singleNode={singleNode}
            singleEdge={singleEdge}
            handlePoints={handlePoints}
            drag={drag}
            nodesById={nodesById}
            ghosts={diagram.settings.sequence ? diagram.nodes.filter((n) => n.reveal !== 'none' && (!playing || selected.has(n.id))) : []}
          />
          {peers.length > 0 && <RemotePresence peers={peers} nodesById={nodesById} geometries={geometries} zoom={viewport.zoom} />}
        </g>
      </svg>
      {editingId && <TextEditor id={editingId} geometries={geometries} />}
    </div>
  );
}

function SelectionLayer(props: {
  selected: Set<string>;
  nodes: NodeElement[];
  edges: EdgeElement[];
  geometries: Map<string, EdgeGeometry>;
  zoom: number;
  singleNode?: NodeElement;
  singleEdge?: EdgeElement;
  handlePoints: (n: NodeElement) => Record<Handle, Point>;
  drag: Drag | null;
  nodesById: Map<string, NodeElement>;
  /** Formes à apparition progressive : contour pointillé pour pouvoir les éditer quand elles sont masquées */
  ghosts: NodeElement[];
}) {
  const { zoom, drag } = props;
  const sw = 1.5 / zoom;
  const pad = 6 / zoom;
  const hs = 8 / zoom;
  const hoverId = drag?.kind === 'arrow' || drag?.kind === 'endpoint' ? drag.hover : undefined;
  const hoverNode = hoverId ? props.nodesById.get(hoverId) : undefined;

  return (
    <g className="af-ui" pointerEvents="none">
      {props.ghosts.map((n) => (
        <rect
          key={`g-${n.id}`}
          x={n.x}
          y={n.y}
          width={n.width}
          height={n.height}
          rx={6 / zoom}
          fill="none"
          stroke="#adb5bd"
          strokeWidth={sw}
          strokeDasharray={`${5 / zoom} ${4 / zoom}`}
        />
      ))}
      {props.nodes
        .filter((n) => props.selected.has(n.id))
        .map((n) => (
          <rect
            key={n.id}
            x={n.x - pad}
            y={n.y - pad}
            width={n.width + pad * 2}
            height={n.height + pad * 2}
            fill="none"
            stroke={SELECTION_COLOR}
            strokeWidth={sw}
            strokeDasharray={props.selected.size > 1 ? `${4 / zoom} ${3 / zoom}` : undefined}
          />
        ))}
      {props.edges
        .filter((e) => props.selected.has(e.id))
        .map((e) => (
          <path
            key={e.id}
            d={props.geometries.get(e.id)!.d}
            fill="none"
            stroke={SELECTION_COLOR}
            strokeOpacity={0.25}
            strokeWidth={e.strokeWidth + 8 / zoom}
            strokeLinecap="round"
          />
        ))}
      {props.singleNode &&
        props.singleNode.shape !== 'text' &&
        Object.values(props.handlePoints(props.singleNode)).map((p, i) => (
          <rect key={i} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} rx={2 / zoom} fill="#fff" stroke={SELECTION_COLOR} strokeWidth={sw} />
        ))}
      {props.singleEdge &&
        [props.geometries.get(props.singleEdge.id)!.start, props.geometries.get(props.singleEdge.id)!.end].map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={hs / 1.6} fill="#fff" stroke={SELECTION_COLOR} strokeWidth={sw} />
        ))}
      {hoverNode && (
        <rect
          x={hoverNode.x - pad}
          y={hoverNode.y - pad}
          width={hoverNode.width + pad * 2}
          height={hoverNode.height + pad * 2}
          rx={8 / zoom}
          fill={SELECTION_COLOR}
          fillOpacity={0.08}
          stroke={SELECTION_COLOR}
          strokeWidth={sw * 1.5}
        />
      )}
      {drag?.kind === 'marquee' && (
        <rect
          x={Math.min(drag.start.x, drag.current.x)}
          y={Math.min(drag.start.y, drag.current.y)}
          width={Math.abs(drag.current.x - drag.start.x)}
          height={Math.abs(drag.current.y - drag.start.y)}
          fill={SELECTION_COLOR}
          fillOpacity={0.06}
          stroke={SELECTION_COLOR}
          strokeWidth={sw}
        />
      )}
      {drag?.kind === 'create' && <CreatePreview shape={drag.shape} a={drag.start} b={drag.current} sw={sw} />}
      {drag?.kind === 'arrow' &&
        (() => {
          const s = drag.source.nodeId ? center(props.nodesById.get(drag.source.nodeId)!) : drag.source;
          const t = hoverNode ? center(hoverNode) : drag.current;
          return <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={SELECTION_COLOR} strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />;
        })()}
    </g>
  );
}

/** Curseurs et sélections des autres participants (taille constante à l'écran). */
function RemotePresence({
  peers,
  nodesById,
  geometries,
  zoom,
}: {
  peers: Peer[];
  nodesById: Map<string, NodeElement>;
  geometries: Map<string, EdgeGeometry>;
  zoom: number;
}) {
  const k = 1 / zoom;
  const pad = 9 * k;
  return (
    <g className="af-ui" pointerEvents="none">
      {peers.map((p) => (
        <g key={p.clientId}>
          {p.selection.map((id) => {
            const n = nodesById.get(id);
            if (n)
              return (
                <rect
                  key={id}
                  x={n.x - pad}
                  y={n.y - pad}
                  width={n.width + pad * 2}
                  height={n.height + pad * 2}
                  rx={4 * k}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={2 * k}
                  strokeDasharray={`${6 * k} ${3 * k}`}
                />
              );
            const g = geometries.get(id);
            return g ? <path key={id} d={g.d} fill="none" stroke={p.color} strokeOpacity={0.35} strokeWidth={10 * k} strokeLinecap="round" /> : null;
          })}
          {p.cursor && (
            <g transform={`translate(${p.cursor.x} ${p.cursor.y}) scale(${k})`}>
              <path d="M0 0 L0 17 L4.5 12.5 L8 20 L11 18.5 L7.5 11.5 L13 11.5 Z" fill={p.color} stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
              <g transform="translate(14 18)">
                <rect x={0} y={0} width={p.name.length * 7 + 14} height={20} rx={6} fill={p.color} />
                <text x={7} y={14} fontSize={12} fontFamily="Inter, system-ui, sans-serif" fill="#fff">
                  {p.name}
                </text>
              </g>
            </g>
          )}
        </g>
      ))}
    </g>
  );
}

function CreatePreview({ shape, a, b, sw }: { shape: ShapeType; a: Point; b: Point; sw: number }) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const common = { fill: 'none', stroke: SELECTION_COLOR, strokeWidth: sw * 1.5, strokeDasharray: `${sw * 4} ${sw * 3}` };
  if (shape === 'ellipse') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
  if (shape === 'diamond') return <path d={`M${x + w / 2} ${y} L${x + w} ${y + h / 2} L${x + w / 2} ${y + h} L${x} ${y + h / 2} Z`} {...common} />;
  return <rect x={x} y={y} width={w} height={h} rx={shape === 'rounded' ? Math.min(18, h / 4) : 0} {...common} />;
}

/** Zone de saisie superposée pour éditer le libellé d'un nœud ou d'un lien. */
function TextEditor({ id, geometries }: { id: string; geometries: Map<string, EdgeGeometry> }) {
  const diagram = useStore((s) => s.diagram);
  const vp = useStore((s) => s.viewport);
  const { commit, setEditing, select } = useStore.getState();
  const node = diagram.nodes.find((n) => n.id === id);
  const edge = node ? undefined : diagram.edges.find((e) => e.id === id);
  const el = node ?? edge;
  const [value, setValue] = useState(el?.label ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!el) return null;

  const c = node ? center(node) : geometries.get(edge!.id)!.mid;
  const fontSize = el.fontSize * vp.zoom;
  const lines = Math.max(1, value.split('\n').length);
  const width = Math.max(node && node.shape !== 'text' ? node.width * vp.zoom - 16 : 0, measureText(value || ' ', el.fontFamily, el.fontSize).width * vp.zoom + 40, 80);
  const height = lines * fontSize * 1.25 + 8;

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(null);
    if (!save) {
      if (node?.shape === 'text' && !node.label) commit((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== id) }));
      return;
    }
    const label = value.replace(/\s+$/, '');
    commit((d) => {
      if (node?.shape === 'text') {
        if (!label) return { ...d, nodes: d.nodes.filter((n) => n.id !== id) };
        const m = measureText(label, node.fontFamily, node.fontSize);
        const w = m.width + 16;
        const h = m.height + 8;
        const cc = center(node);
        return { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, label, width: w, height: h, x: cc.x - w / 2, y: cc.y - h / 2 } : n)) };
      }
      if (node) return { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, label } : n)) };
      return { ...d, edges: d.edges.map((e) => (e.id === id ? { ...e, label } : e)) };
    });
    if (node?.shape === 'text' && !label) select([]);
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(true);
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
      }}
      style={{
        left: c.x * vp.zoom + vp.x - width / 2,
        top: c.y * vp.zoom + vp.y - height / 2,
        width,
        height,
        fontSize,
        fontFamily: FONT_STACKS[el.fontFamily],
        color: node ? node.textColor : edge!.strokeColor,
      }}
    />
  );
}
