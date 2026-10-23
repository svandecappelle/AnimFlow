import { FONTS_CSS_URL, normalizeDiagram } from '../defaults';
import { cameraKeyframes, cameraSmil, type CameraKey } from '../camera';
import { FONT_STACKS } from '../defaults';
import { STICKY, stickyFill, stickyLabel, stickyNodes, stickyVisible, stickyWidth } from '../sticky';
import { diagramBounds } from '../geometry';
import type { Diagram } from '../types';
import { emptyDiagram } from '../defaults';
import { isWorkspaceFile, type WorkspaceFile } from '../workspace';
import { describeSkipped, excalidrawToElements, isExcalidrawData } from './excalidraw';

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
export function exportSvgString(d: Diagram, canvas: SVGSVGElement, padding = 40, aspect?: number): string {
  const content = canvas.querySelector('.af-content');
  if (!content) throw new Error('Canevas introuvable');
  const b = diagramBounds(d) ?? { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  let x = Math.floor(b.minX - padding);
  let y = Math.floor(b.minY - padding);
  let w = Math.ceil(b.maxX - b.minX + padding * 2);
  let h = Math.ceil(b.maxY - b.minY + padding * 2);
  if (aspect) {
    // Proportions imposées (ex. 16:9 pour une vidéo) : on agrandit le cadre autour du schéma
    if (w / h < aspect) {
      const nw = Math.ceil(h * aspect);
      x -= Math.round((nw - w) / 2);
      w = nw;
    } else {
      const nh = Math.ceil(w / aspect);
      y -= Math.round((nh - h) / 2);
      h = nh;
    }
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  // L'espace de noms SVG est déclaré par le sérialiseur (élément créé avec createElementNS) : le redéclarer en
  // attribut produit un `xmlns` en double, rejeté par les analyseurs XML stricts
  svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', XLINK_NS);
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
  const camKeys = cameraKeyframes(d, { width: w, height: h });
  const cam = cameraSmil(camKeys);
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
    // En-têtes collants : suivent la caméra (mêmes images clés), à taille constante à l'écran
    const headers = stickyHeadersSvg(d, camKeys, w);
    if (headers) svg.append(headers);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

function svgEl(tag: string, attrs: Record<string, string | number>, children: Node[] = []): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

/**
 * En-têtes collants animés pour un SVG dont la caméra anime le viewBox : pour chaque image clé, position en haut
 * du cadre, échelle inverse du zoom (taille constante à l'écran) et visibilité (seulement quand la forme est sortie
 * par le haut). Interpolés avec les mêmes temps et courbes que le viewBox.
 */
function stickyHeadersSvg(d: Diagram, keys: CameraKey[], outputWidth: number): SVGElement | null {
  const nodes = stickyNodes(d.nodes);
  if (!nodes.length || keys.length < 2) return null;
  const cycle = keys[keys.length - 1].t;
  const timing = {
    keyTimes: keys.map((k) => String(Math.round((k.t / cycle) * 10000) / 10000)).join(';'),
    keySplines: keys.slice(1).map(() => '0.5 0 0.5 1').join(';'),
    calcMode: 'spline',
    dur: `${cycle}s`,
    repeatCount: 'indefinite',
  };
  const r = (n: number) => Math.round(n * 100) / 100;
  const scales = keys.map((k) => (k.b.maxX - k.b.minX) / outputWidth);
  const group = svgEl('g', { class: 'af-sticky' });
  for (const n of nodes) {
    const cx = n.x + n.width / 2;
    const w = stickyWidth(n);
    const header = svgEl('g', {}, [
      svgEl('animateTransform', { attributeName: 'transform', type: 'scale', values: scales.map(r).join(';'), ...timing }),
      svgEl('rect', { x: -w / 2, y: 0, width: w, height: STICKY.height, rx: 6, fill: stickyFill(n), stroke: n.strokeColor, 'stroke-width': 1.5 }),
      svgEl(
        'text',
        {
          x: 0,
          y: STICKY.height / 2,
          'font-family': FONT_STACKS[n.fontFamily],
          'font-size': STICKY.fontSize,
          fill: n.textColor,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
        },
        [document.createTextNode(stickyLabel(n))],
      ),
    ]);
    const positioned = svgEl('g', {}, [
      svgEl('animateTransform', {
        attributeName: 'transform',
        type: 'translate',
        values: keys.map((k, i) => `${r(cx)} ${r(k.b.minY + STICKY.margin * scales[i])}`).join(';'),
        ...timing,
      }),
      header,
    ]);
    const visibility = keys.map((k, i) => (stickyVisible(n, k.b.minY, scales[i]) ? 0.95 : 0));
    if (visibility.every((v) => v === 0)) continue;
    group.append(svgEl('g', { opacity: 0 }, [svgEl('animate', { attributeName: 'opacity', values: visibility.join(';'), ...timing }), positioned]));
  }
  return group.childNodes.length ? group : null;
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

export type ParsedFile =
  | { kind: 'diagram'; diagram: Diagram; notice?: string | null }
  | { kind: 'workspace'; file: WorkspaceFile }
  | { kind: 'mermaid'; source: string };

/** Reconnaît un contenu importé : JSON AnimFlow, SVG exporté par AnimFlow, ou texte Mermaid. */
export function parseImportedText(text: string): ParsedFile {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    const raw = JSON.parse(trimmed);
    if (isExcalidrawData(raw)) {
      const { nodes, edges, skipped } = excalidrawToElements(raw);
      const background = raw.appState?.viewBackgroundColor;
      const base = emptyDiagram();
      return {
        kind: 'diagram',
        diagram: { ...base, nodes, edges, settings: { ...base.settings, ...(background ? { background } : {}) } },
        notice: describeSkipped(skipped),
      };
    }
    if (isWorkspaceFile(raw)) {
      const documents = (Array.isArray(raw.documents) ? raw.documents : []).map((doc) => ({
        name: String(doc?.name ?? 'Sans titre'),
        diagram: normalizeDiagram(doc?.diagram),
      }));
      return { kind: 'workspace', file: { ...raw, documents } };
    }
    return { kind: 'diagram', diagram: normalizeDiagram(raw) };
  }
  if (trimmed.startsWith('<')) {
    const m = new RegExp(`${META_PREFIX}([A-Za-z0-9+/=]+)`).exec(trimmed);
    if (!m) throw new Error("Ce SVG n'a pas été exporté par AnimFlow (métadonnées absentes).");
    return { kind: 'diagram', diagram: normalizeDiagram(JSON.parse(fromBase64(m[1]))) };
  }
  if (/^(graph|flowchart|sequenceDiagram)\b/i.test(trimmed.replace(/^(%%.*\n|\s)*/, ''))) return { kind: 'mermaid', source: trimmed };
  throw new Error('Format non reconnu (attendu : .animflow.json, workspace, .excalidraw, .svg AnimFlow ou Mermaid flowchart / sequenceDiagram).');
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
