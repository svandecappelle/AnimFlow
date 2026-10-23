import type {
  Diagram,
  DiagramSettings,
  EdgeAnimation,
  EdgeElement,
  EdgeEnd,
  FontFamily,
  NodeElement,
  ShapeType,
} from './types';

export const uid = (prefix: string) =>
  `${prefix}${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 8)}`;

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

export const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599'];
export const FILL_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#eebefa', '#99e9f2'];
export const BACKGROUND_COLORS = ['#ffffff', '#f8f9fa', '#fff9db', '#e7f5ff', '#1e1e2e'];

export const FONT_STACKS: Record<FontFamily, string> = {
  hand: "Kalam, 'Comic Sans MS', 'Segoe Print', cursive",
  sans: "Inter, system-ui, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

export const FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&family=Inter:wght@400;500;600&family=JetBrains+Mono&display=swap';

export const DEFAULT_SIZES: Record<ShapeType, [number, number]> = {
  rectangle: [160, 80],
  rounded: [160, 80],
  ellipse: [150, 90],
  diamond: [170, 110],
  text: [120, 32],
};

export function createNode(
  shape: ShapeType,
  x: number,
  y: number,
  width = DEFAULT_SIZES[shape][0],
  height = DEFAULT_SIZES[shape][1],
  patch: Partial<NodeElement> = {},
): NodeElement {
  return {
    id: uid('n'),
    type: 'node',
    shape,
    x,
    y,
    width,
    height,
    label: '',
    strokeColor: '#1e1e1e',
    fillColor: shape === 'text' ? 'transparent' : '#a5d8ff',
    fillStyle: shape === 'text' ? 'none' : 'hachure',
    strokeWidth: 2,
    roughness: 1,
    fontFamily: 'hand',
    fontSize: 20,
    textColor: '#1e1e1e',
    animation: 'none',
    reveal: 'none',
    revealDelay: null,
    seed: randomSeed(),
    ...patch,
  };
}

export function defaultEdgeAnimation(): EdgeAnimation {
  return {
    type: 'flow',
    duration: 1.5,
    delay: 0,
    reverse: false,
    particleCount: 3,
    particleSize: 4,
    color: null,
    extraPause: 0,
  };
}

export function createEdge(source: EdgeEnd, target: EdgeEnd, patch: Partial<EdgeElement> = {}): EdgeElement {
  return {
    id: uid('e'),
    type: 'edge',
    source,
    target,
    label: '',
    strokeColor: '#1e1e1e',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    routing: 'straight',
    arrowHeads: 'end',
    fontFamily: 'hand',
    fontSize: 16,
    animation: defaultEdgeAnimation(),
    reveal: false,
    seed: randomSeed(),
    ...patch,
  };
}

export function defaultSettings(): DiagramSettings {
  return { background: '#ffffff', sequence: false, sequenceGap: 1, stepPause: 0.3, loopPause: 0, manualOrder: false, camera: 'off' };
}

export function emptyDiagram(): Diagram {
  return { version: 1, nodes: [], edges: [], settings: defaultSettings() };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Valide un diagramme importé et complète les champs manquants. Lève une erreur si le format est invalide. */
export function normalizeDiagram(raw: unknown): Diagram {
  if (!isObj(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('Format de diagramme invalide (nodes/edges manquants)');
  }
  const nodes: NodeElement[] = raw.nodes.filter(isObj).map((n) => {
    const shape = (n.shape as ShapeType) in DEFAULT_SIZES ? (n.shape as ShapeType) : 'rectangle';
    const base = createNode(shape, 0, 0);
    return {
      ...base,
      ...(n as Partial<NodeElement>),
      id: typeof n.id === 'string' ? n.id : base.id,
      type: 'node',
      shape,
      x: num(n.x, 0),
      y: num(n.y, 0),
      width: Math.max(10, num(n.width, base.width)),
      height: Math.max(10, num(n.height, base.height)),
      label: typeof n.label === 'string' ? n.label : '',
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const normEnd = (e: unknown): EdgeEnd => {
    const o = isObj(e) ? e : {};
    const nodeId = typeof o.nodeId === 'string' && ids.has(o.nodeId) ? o.nodeId : undefined;
    return { nodeId, x: num(o.x, 0), y: num(o.y, 0) };
  };
  const edges: EdgeElement[] = raw.edges.filter(isObj).map((e) => {
    const base = createEdge({ x: 0, y: 0 }, { x: 0, y: 0 });
    return {
      ...base,
      ...(e as Partial<EdgeElement>),
      id: typeof e.id === 'string' ? e.id : base.id,
      type: 'edge',
      source: normEnd(e.source),
      target: normEnd(e.target),
      label: typeof e.label === 'string' ? e.label : '',
      animation: { ...base.animation, ...(isObj(e.animation) ? (e.animation as Partial<EdgeAnimation>) : {}) },
    };
  });
  const settings = { ...defaultSettings(), ...(isObj(raw.settings) ? raw.settings : {}) } as DiagramSettings;
  return { version: 1, nodes, edges, settings };
}
