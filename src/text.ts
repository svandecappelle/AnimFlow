import { FONT_STACKS } from './defaults';
import type { FontFamily } from './types';

/** « 1 forme », « 3 formes » */
export const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

let ctx: CanvasRenderingContext2D | null | undefined;

/** Taille approximative d'un texte multi-ligne (canvas si disponible, estimation sinon). */
export function measureText(text: string, fontFamily: FontFamily, fontSize: number): { width: number; height: number } {
  const lines = text.split('\n');
  if (ctx === undefined) {
    try {
      ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  let width = 0;
  for (const line of lines) {
    if (ctx) {
      ctx.font = `${fontSize}px ${FONT_STACKS[fontFamily]}`;
      width = Math.max(width, ctx.measureText(line).width);
    } else {
      width = Math.max(width, line.length * fontSize * 0.6);
    }
  }
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * 1.25) };
}
