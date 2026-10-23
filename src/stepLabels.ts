/** Noms lisibles des éléments d'une étape (panneau d'ordre, vue présentateur). */
import type { SequenceStep } from './animation';
import type { Diagram, EdgeElement, NodeElement } from './types';

const SHAPE_NAMES: Record<string, string> = { rectangle: 'Rectangle', rounded: 'Rectangle', ellipse: 'Ellipse', diamond: 'Losange', text: 'Texte' };

const firstLine = (s: string) => s.split('\n')[0].trim();

export const nodeName = (n?: NodeElement) => (n ? firstLine(n.label) || SHAPE_NAMES[n.shape] : '•');

export function edgeName(e: EdgeElement, nodes: Map<string, NodeElement>) {
  const src = e.source.nodeId ? nodes.get(e.source.nodeId) : undefined;
  const tgt = e.target.nodeId ? nodes.get(e.target.nodeId) : undefined;
  const route = `${nodeName(src)} → ${nodeName(tgt)}`;
  if (!e.label) return route;
  // Sans forme reliée (messages de diagramme de séquence), le trajet n'apporte rien
  return src || tgt ? `${firstLine(e.label)} (${route})` : firstLine(e.label);
}

/** Libellés des éléments d'une étape, puis des formes qu'elle fait apparaître (formes sans nom omises). */
export function stepItemNames(d: Diagram, step: SequenceStep): string[] {
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const edges = new Map(d.edges.map((e) => [e.id, e]));
  const named = (id: string) => !!nodes.get(id)?.label.trim();
  return [
    ...step.items.flatMap((i) => {
      const e = edges.get(i.id);
      if (e) return [edgeName(e, nodes)];
      return named(i.id) ? [`Apparition : ${nodeName(nodes.get(i.id))}`] : [];
    }),
    ...step.arrivals.filter(named).map((id) => `↳ apparaît : ${nodeName(nodes.get(id))}`),
  ];
}
