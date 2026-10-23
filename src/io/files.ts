import { FONTS_CSS_URL, normalizeDiagram } from '../defaults';
import { cameraKeyframes, cameraSmil } from '../camera';
import { diagramBounds } from '../geometry';
import type { Diagram } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const META_PREFIX = 'animflow:';
export const FILE_EXTENSION = '.animflow.json';

export function download(filename: string, content: Blob | string, mime = 'application/octet-stream') {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const serializeDiagram = (d: Diagram) => JSON.stringify(d, null, 2);

const toBase64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const fromBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

/**
 * SVG autonome et animé (SMIL) à partir du rendu courant du canevas.
 * Le diagramme source est embarqué dans <metadata> : le fichier peut être ré-importé.
 */
export function exportSvgString(d: Diagram, canvas: SVGSVGElement, padding = 40): string {
  const content = canvas.querySelector('.af-content');
  if (!content) throw new Error('Canevas introuvable');
  const b = diagramBounds(d) ?? { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const x = Math.floor(b.minX - padding);
  const y = Math.floor(b.minY - padding);
  const w = Math.ceil(b.maxX - b.minX + padding * 2);
  const h = Math.ceil(b.maxY - b.minY + padding * 2);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('xmlns:xlink', XLINK_NS);
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));

  const meta = document.createElementNS(SVG_NS, 'metadata');
  meta.textContent = META_PREFIX + toBase64(JSON.stringify(d));
  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = `@import url('${FONTS_CSS_URL}');`;
  const bg = document.createElementNS(SVG_NS, 'rect');
  // Fond débordant : la caméra peut cadrer au-delà des bords du schéma
  bg.setAttribute('x', String(x - w));
  bg.setAttribute('y', String(y - h));
  bg.setAttribute('width', String(w * 3));
  bg.setAttribute('height', String(h * 3));
  bg.setAttribute('fill', d.settings.background);

  const clone = content.cloneNode(true) as SVGGElement;
  // Compatibilité avec les lecteurs SVG 1.1
  clone.querySelectorAll('mpath').forEach((m) => {
    const href = m.getAttribute('href');
    if (href) m.setAttributeNS(XLINK_NS, 'xlink:href', href);
  });
  svg.append(meta, style, bg, clone);

  // Caméra de suivi : animation du viewBox (mêmes images clés que dans l'éditeur)
  const cam = cameraSmil(cameraKeyframes(d, { width: w, height: h }));
  if (cam) {
    const anim = document.createElementNS(SVG_NS, 'animate');
    anim.setAttribute('attributeName', 'viewBox');
    anim.setAttribute('values', cam.values);
    anim.setAttribute('keyTimes', cam.keyTimes);
    anim.setAttribute('keySplines', cam.keySplines);
    anim.setAttribute('calcMode', 'spline');
    anim.setAttribute('dur', `${cam.dur}s`);
    anim.setAttribute('repeatCount', 'indefinite');
    svg.append(anim);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

/** PNG statique (2x) de l'état courant. */
export async function exportPngBlob(svgString: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Rendu PNG impossible'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Rendu PNG impossible'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type ParsedFile = { kind: 'diagram'; diagram: Diagram } | { kind: 'mermaid'; source: string };

/** Reconnaît un contenu importé : JSON AnimFlow, SVG exporté par AnimFlow, ou texte Mermaid. */
export function parseImportedText(text: string): ParsedFile {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return { kind: 'diagram', diagram: normalizeDiagram(JSON.parse(trimmed)) };
  if (trimmed.startsWith('<')) {
    const m = new RegExp(`${META_PREFIX}([A-Za-z0-9+/=]+)`).exec(trimmed);
    if (!m) throw new Error("Ce SVG n'a pas été exporté par AnimFlow (métadonnées absentes).");
    return { kind: 'diagram', diagram: normalizeDiagram(JSON.parse(fromBase64(m[1]))) };
  }
  if (/^(graph|flowchart|sequenceDiagram)\b/i.test(trimmed.replace(/^(%%.*\n|\s)*/, ''))) return { kind: 'mermaid', source: trimmed };
  throw new Error('Format non reconnu (attendu : .animflow.json, .svg AnimFlow ou Mermaid flowchart / sequenceDiagram).');
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
