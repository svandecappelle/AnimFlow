/**
 * En-têtes collants : une forme marquée `sticky` (participant d'un diagramme de séquence, en-tête de couloir…)
 * reste rappelée en haut de la vue quand elle en sort, alignée sur sa colonne. Mêmes dimensions (en pixels écran)
 * dans l'éditeur et dans les exports SVG / vidéo.
 */
import { measureText } from './text';
import type { NodeElement } from './types';

export const STICKY = { height: 26, fontSize: 13, margin: 8, padX: 10, maxWidth: 240 };

export const stickyNodes = (nodes: NodeElement[]) => nodes.filter((n) => n.sticky && n.label.trim());

export const stickyLabel = (n: NodeElement) => n.label.split('\n')[0].trim();

/** Largeur de l'en-tête (pixels écran) */
export const stickyWidth = (n: NodeElement) =>
  Math.min(STICKY.maxWidth, measureText(stickyLabel(n), n.fontFamily, STICKY.fontSize).width + STICKY.padX * 2);

/** Fond de l'en-tête : couleur de la forme, ou blanc si elle n'est pas remplie */
export const stickyFill = (n: NodeElement) => (n.fillStyle === 'none' || n.fillColor === 'transparent' ? '#ffffff' : n.fillColor);

/**
 * L'en-tête est montré quand le bas de la forme est passé au-dessus de la zone où il s'affiche.
 * `viewTop` : haut de la vue en coordonnées du schéma ; `scale` : unités du schéma par pixel écran.
 */
export const stickyVisible = (n: NodeElement, viewTop: number, scale: number) =>
  n.y + n.height < viewTop + (STICKY.margin + STICKY.height) * scale;
