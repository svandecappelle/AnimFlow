/**
 * Import du contenu Excalidraw : presse-papiers (`excalidraw/clipboard`, copié avec Ctrl+C sur excalidraw.com)
 * et fichiers `.excalidraw`.
 *
 * Correspondances :
 *  - rectangle (arrondi si `roundness`), ellipse, losange → formes ; leur texte lié (`containerId`) → libellé ;
 *  - text libre → forme texte ;
 *  - arrow / line → liens, rattachés aux formes via `startBinding` / `endBinding`, sinon extrémités libres ;
 *    flèche coudée → tracé coudé, flèche à plusieurs points → courbe passant par le point du milieu ;
 *  - freedraw, image, frame, embeddable… → ignorés (comptés dans `skipped`).
 */
import { createEdge, createNode, defaultEdgeAnimation } from '../defaults';
import { snapEdge } from '../geometry';
import type { ArrowHeads, EdgeElement, FillStyle, FontFamily, NodeElement, StrokeStyle } from '../types';

interface ExElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  roundness?: unknown;
  seed?: number;
  // texte
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  containerId?: string | null;
  // flèches et lignes
  points?: [number, number][];
  startBinding?: { elementId?: string } | null;
  endBinding?: { elementId?: string } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  elbowed?: boolean;
}

export interface ExcalidrawImport {
  nodes: NodeElement[];
  edges: EdgeElement[];
  /** Éléments sans équivalent, par type */
  skipped: Record<string, number>;
  /** Extrémités de flèches non liées dans Excalidraw, raccrochées à une forme proche */
  snapped: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Types reconnus par Excalidraw lui-même au collage (fichier, presse-papiers, presse-papiers via l'API) */
const EXCALIDRAW_TYPES = ['excalidraw', 'excalidraw/clipboard', 'excalidraw-api/clipboard'];

/** Contenu Excalidraw (presse-papiers ou fichier) ? */
export function isExcalidrawData(raw: unknown): raw is { elements: unknown[]; appState?: { viewBackgroundColor?: string } } {
  return isObj(raw) && EXCALIDRAW_TYPES.includes(raw.type as string) && Array.isArray(raw.elements);
}

// Polices Excalidraw : 1 Virgil, 2 Helvetica, 3 Cascadia, 5 Excalifont, 6 Nunito, 7 Lilita One, 8 Comic Shanns
const FONTS: Record<number, FontFamily> = { 1: 'hand', 2: 'sans', 3: 'mono', 5: 'hand', 6: 'sans', 7: 'sans', 8: 'mono' };
const font = (f?: number): FontFamily => FONTS[f ?? 1] ?? 'hand';

function fill(el: ExElement): { fillColor: string; fillStyle: FillStyle } {
  const color = el.backgroundColor ?? 'transparent';
  if (color === 'transparent') return { fillColor: 'transparent', fillStyle: 'none' };
  const style: FillStyle = el.fillStyle === 'solid' ? 'solid' : el.fillStyle === 'cross-hatch' ? 'cross-hatch' : el.fillStyle === 'dots' ? 'dots' : 'hachure';
  return { fillColor: color, fillStyle: style };
}

const strokeStyle = (s?: string): StrokeStyle => (s === 'dashed' ? 'dashed' : s === 'dotted' ? 'dotted' : 'solid');

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function excalidrawToElements(raw: { elements: unknown[] }): ExcalidrawImport {
  const elements = raw.elements.filter((e): e is ExElement => isObj(e) && typeof e.id === 'string' && typeof e.type === 'string' && !e.isDeleted);
  const skipped: Record<string, number> = {};
  const nodes: NodeElement[] = [];
  const edges: EdgeElement[] = [];
  const idMap = new Map<string, NodeElement>();
  let snapped = 0;

  // Textes liés à un conteneur (forme ou flèche) → libellé du conteneur
  const boundText = new Map<string, ExElement>();
  for (const el of elements) if (el.type === 'text' && el.containerId) boundText.set(el.containerId, el);
  const containerIds = new Set(elements.map((e) => e.id));

  for (const el of elements) {
    const label = boundText.get(el.id);
    const common = {
      strokeColor: el.strokeColor ?? '#1e1e1e',
      strokeWidth: num(el.strokeWidth, 2),
      roughness: Math.max(0, Math.min(2, num(el.roughness, 1))),
      seed: num(el.seed, Math.floor(Math.random() * 2 ** 31)),
    };
    switch (el.type) {
      case 'rectangle':
      case 'ellipse':
      case 'diamond': {
        const shape = el.type === 'rectangle' ? (el.roundness ? 'rounded' : 'rectangle') : el.type;
        const x = Math.min(el.x, el.x + el.width);
        const y = Math.min(el.y, el.y + el.height);
        const node = createNode(shape, x, y, Math.max(10, Math.abs(el.width)), Math.max(10, Math.abs(el.height)), {
          ...common,
          ...fill(el),
          label: label?.text ?? '',
          fontFamily: font(label?.fontFamily),
          fontSize: num(label?.fontSize, 20),
          textColor: label?.strokeColor ?? common.strokeColor,
        });
        nodes.push(node);
        idMap.set(el.id, node);
        break;
      }
      case 'text': {
        // Un texte lié à un conteneur existant est déjà repris comme libellé
        if (el.containerId && containerIds.has(el.containerId)) break;
        nodes.push(
          createNode('text', el.x, el.y, Math.max(10, el.width), Math.max(10, el.height), {
            ...common,
            label: el.text ?? el.originalText ?? '',
            fontFamily: font(el.fontFamily),
            fontSize: num(el.fontSize, 20),
            textColor: common.strokeColor,
          }),
        );
        break;
      }
      case 'arrow':
      case 'line':
        break; // traités après les formes (liaisons)
      default:
        skipped[el.type] = (skipped[el.type] ?? 0) + 1;
    }
  }

  for (const el of elements) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const pts = (el.points?.length ? el.points : [[0, 0], [el.width, el.height]]).map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
    if (pts.length < 2) continue;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const source = idMap.get(el.startBinding?.elementId ?? '');
    const target = idMap.get(el.endBinding?.elementId ?? '');
    const end = (n: NodeElement | undefined, p: { x: number; y: number }) =>
      n ? { nodeId: n.id, x: n.x + n.width / 2, y: n.y + n.height / 2 } : { x: p.x, y: p.y };

    const start = !!el.startArrowhead;
    const finish = !!el.endArrowhead;
    const arrowHeads: ArrowHeads = start && finish ? 'both' : finish ? 'end' : start ? 'start' : 'none';

    // Plusieurs points : courbe passant par le point du milieu (B(½) = milieu + ½·(contrôle − milieu))
    let routing: EdgeElement['routing'] = el.elbowed ? 'elbow' : 'straight';
    let curvature: number | undefined;
    if (!el.elbowed && pts.length > 2) {
      const mid = pts[Math.floor(pts.length / 2)];
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const len = Math.hypot(dx, dy) || 1;
      const offset = ((mid.x - (first.x + last.x) / 2) * -dy + (mid.y - (first.y + last.y) / 2) * dx) / len;
      if (Math.abs(offset) > 4) {
        routing = 'curved';
        curvature = (2 * offset) / len;
      }
    }

    const label = boundText.get(el.id);
    const edge = createEdge(end(source, first), end(target, last), {
      ...{
        strokeColor: el.strokeColor ?? '#1e1e1e',
        strokeWidth: num(el.strokeWidth, 2),
        roughness: Math.max(0, Math.min(2, num(el.roughness, 1))),
        seed: num(el.seed, Math.floor(Math.random() * 2 ** 31)),
      },
      strokeStyle: strokeStyle(el.strokeStyle),
      arrowHeads,
      routing,
      curvature,
      label: label?.text ?? '',
      fontFamily: font(label?.fontFamily),
      fontSize: num(label?.fontSize, 16),
      // Collage fidèle : pas d'animation, à choisir ensuite (sélection → « Animation du flux »)
      animation: { ...defaultEdgeAnimation(), type: 'none' },
    });
    // Flèche dessinée contre une forme sans y être liée dans Excalidraw : on la raccroche (les lignes restent libres)
    if (el.type === 'arrow') {
      const snappedEdge = snapEdge(edge, nodes);
      snapped += Number(snappedEdge.source !== edge.source) + Number(snappedEdge.target !== edge.target);
      edges.push(snappedEdge);
    } else edges.push(edge);
  }

  return { nodes, edges, skipped, snapped };
}

const SKIPPED_NAMES: Record<string, [singular: string, plural: string]> = {
  freedraw: ['dessin à main levée', 'dessins à main levée'],
  image: ['image', 'images'],
  frame: ['cadre', 'cadres'],
  magicframe: ['cadre', 'cadres'],
  embeddable: ['contenu intégré', 'contenus intégrés'],
  iframe: ['contenu intégré', 'contenus intégrés'],
};

/** « 2 dessins à main levée et 1 image ignorés » */
export function describeSkipped(skipped: Record<string, number>): string | null {
  const parts = Object.entries(skipped).map(([type, n]) => {
    const [one, many] = SKIPPED_NAMES[type] ?? [`élément « ${type} »`, `éléments « ${type} »`];
    return `${n} ${n > 1 ? many : one}`;
  });
  if (!parts.length) return null;
  const total = Object.values(skipped).reduce((a, b) => a + b, 0);
  return `${parts.join(', ')} ignoré${total > 1 ? 's' : ''} (sans équivalent dans AnimFlow)`;
}
