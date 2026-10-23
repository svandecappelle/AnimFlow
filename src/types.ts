export interface Point {
  x: number;
  y: number;
}

export type ShapeType = 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'text';
export type FillStyle = 'none' | 'solid' | 'hachure' | 'cross-hatch' | 'dots';
export type FontFamily = 'hand' | 'sans' | 'mono';
export type NodeAnimation = 'none' | 'pulse' | 'glow' | 'blink';
/** Apparition de la forme à l'arrivée du premier flux (mode séquence) */
export type NodeReveal = 'none' | 'fade' | 'pop';
export type EdgeAnimationType = 'none' | 'flow' | 'particles' | 'comet' | 'draw';
export type Routing = 'straight' | 'curved' | 'elbow';
export type ArrowHeads = 'end' | 'start' | 'both' | 'none';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
/** Caméra qui suit l'animation (mode séquence) : désactivée ou niveau de rapprochement */
export type CameraMode = 'off' | 'veryClose' | 'close' | 'medium' | 'wide';

export interface NodeElement {
  id: string;
  type: 'node';
  shape: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  strokeColor: string;
  fillColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  /** 0 = tracé net (style Mermaid), 1-2 = dessiné à la main (style Excalidraw) */
  roughness: number;
  fontFamily: FontFamily;
  fontSize: number;
  textColor: string;
  animation: NodeAnimation;
  reveal: NodeReveal;
  /** Instant d'apparition imposé (s) ; null = à l'arrivée du premier flux */
  revealDelay: number | null;
  seed: number;
}

/** Extrémité d'un lien : rattachée à un nœud (nodeId) ou libre (x, y). */
export interface EdgeEnd {
  nodeId?: string;
  x: number;
  y: number;
}

export interface EdgeAnimation {
  type: EdgeAnimationType;
  /** Durée d'un parcours, en secondes */
  duration: number;
  /** Décalage de départ, en secondes (sert d'ordonnancement en mode séquence) */
  delay: number;
  reverse: boolean;
  particleCount: number;
  particleSize: number;
  /** Couleur de l'animation ; null = couleur du trait */
  color: string | null;
  /** Pause supplémentaire avant ce flux (s), en plus de la pause entre animations (mode séquence) */
  extraPause: number;
}

export interface EdgeElement {
  id: string;
  type: 'edge';
  source: EdgeEnd;
  target: EdgeEnd;
  label: string;
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  routing: Routing;
  arrowHeads: ArrowHeads;
  fontFamily: FontFamily;
  fontSize: number;
  animation: EdgeAnimation;
  /** Apparaît au démarrage de son flux (instant = animation.delay), en mode séquence */
  reveal: boolean;
  /** Courbure d'un lien « courbe » (0.25 par défaut, négatif = de l'autre côté) */
  curvature?: number;
  seed: number;
}

export type DiagramElement = NodeElement | EdgeElement;

export interface DiagramSettings {
  background: string;
  /** Mode séquence : les animations jouent une fois chacune, dans l'ordre des délais, puis la boucle recommence */
  sequence: boolean;
  /** Pause en fin de cycle (secondes) en mode séquence */
  sequenceGap: number;
  /** Pause entre deux animations successives (s), mode séquence */
  stepPause: number;
  /** Pause entre deux répétitions d'une même animation (s), mode boucle */
  loopPause: number;
  /** Ordre fixé à la main (panneau « Ordre des étapes ») : minutage linéaire, étape après étape */
  manualOrder: boolean;
  camera: CameraMode;
}

export interface Diagram {
  version: 1;
  nodes: NodeElement[];
  edges: EdgeElement[];
  settings: DiagramSettings;
}
