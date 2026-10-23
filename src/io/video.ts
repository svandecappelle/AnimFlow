/**
 * Export vidéo (MP4 / WebM via WebCodecs, GIF via gifenc), rendu image par image.
 *
 * Le SVG exporté (animations SMIL, caméra comprise) est placé hors écran et mis en pause. Pour chaque image :
 *  1. `setCurrentTime(t)` positionne toutes les animations ;
 *  2. les valeurs animées du moment (opacité, stroke-dashoffset, transformations — dont la position des particules
 *     sur leur trajet — et viewBox) sont figées dans une copie statique du SVG, sans éléments d'animation ;
 *  3. la copie est dessinée dans un canvas, puis encodée.
 * Le rendu ne dépend donc pas de la vitesse de la machine : la vidéo est fluide même si une image est lente à calculer.
 */
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
} from 'mediabunny';
import { edgeWindow, sequenceCycle } from '../animation';
import type { Diagram, FontFamily } from '../types';
import { exportSvgString } from './files';

export type VideoFormat = 'mp4' | 'webm' | 'gif';

export interface VideoOptions {
  format: VideoFormat;
  /** Largeur de la vidéo (px) ; la hauteur suit les proportions du schéma */
  width: number;
  fps: number;
  /** Durée (s) */
  duration: number;
  /** Proportions largeur/hauteur imposées ; absent = celles du schéma */
  aspect?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const ANIMATIONS = 'animate, set, animateMotion, animateTransform';

/** Durée proposée : un cycle en mode séquence, sinon assez pour voir chaque animation se répéter. */
export function defaultVideoDuration(d: Diagram): number {
  if (d.settings.sequence) return Math.round(sequenceCycle(d) * 10) / 10;
  let longest = 0;
  for (const e of d.edges) {
    if (e.animation.type === 'none') continue;
    const w = edgeWindow(e, d.settings, 0);
    longest = Math.max(longest, w.begin + w.dur * 2);
  }
  return Math.min(20, Math.max(4, Math.ceil(longest)));
}

/** Formats encodables par ce navigateur, avec le codec utilisé (le GIF l'est toujours). */
export async function supportedFormats(): Promise<{ format: VideoFormat; codec: string }[]> {
  const out: { format: VideoFormat; codec: string }[] = [];
  if (typeof VideoEncoder !== 'undefined') {
    for (const format of ['mp4', 'webm'] as const) {
      const codec = await pickCodec(format, 1280, 720);
      if (codec) out.push({ format, codec });
    }
  }
  out.push({ format: 'gif', codec: 'gif' });
  return out;
}

async function pickCodec(format: 'mp4' | 'webm', width: number, height: number) {
  const fmt = format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
  const preferred = format === 'mp4' ? (['avc', 'hevc', 'av1'] as const) : (['vp9', 'vp8', 'av1'] as const);
  const codecs = preferred.filter((c) => fmt.getSupportedVideoCodecs().includes(c));
  return getFirstEncodableVideoCodec([...codecs], { width, height });
}

// ---------------------------------------------------------------------------------------------------------------
// Polices : une image SVG ne peut pas charger de ressources externes, on les embarque en data: URI

const FONT_QUERIES: Record<FontFamily, string> = {
  hand: 'family=Kalam:wght@400;700',
  sans: 'family=Inter:wght@400;500;600',
  mono: 'family=JetBrains+Mono',
};
const fontCache = new Map<FontFamily, Promise<string>>();

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

function loadFontCss(family: FontFamily): Promise<string> {
  let p = fontCache.get(family);
  if (!p) {
    p = (async () => {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?${FONT_QUERIES[family]}&display=block`)).text();
      // Seuls les sous-ensembles latins sont gardés (accents compris) pour limiter la taille de chaque image
      const blocks = css.split(/(?=\/\* )/).filter((b) => /^\/\* latin(-ext)? \*\//.test(b));
      const parts = await Promise.all(
        blocks.map(async (b) => {
          const url = /url\((https:[^)]+)\)/.exec(b)?.[1];
          return url ? b.replace(url, await toDataUrl(await (await fetch(url)).blob())) : b;
        }),
      );
      return parts.join('\n');
    })().catch(() => {
      fontCache.delete(family); // hors ligne : police de secours, on réessaiera au prochain export
      return '';
    });
    fontCache.set(family, p);
  }
  return p;
}

async function embeddedFontsCss(d: Diagram): Promise<string> {
  const used = new Set<FontFamily>([...d.nodes.map((n) => n.fontFamily), ...d.edges.filter((e) => e.label).map((e) => e.fontFamily)]);
  return (await Promise.all([...used].map(loadFontCss))).join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Rendu d'une image à l'instant t

interface Baker {
  width: number;
  height: number;
  /** Rend l'image à l'instant t dans le contexte 2D */
  draw(t: number, ctx: CanvasRenderingContext2D): Promise<void>;
  dispose(): void;
}

async function createBaker(d: Diagram, canvasSvg: SVGSVGElement, width: number, aspect?: number): Promise<Baker> {
  const doc = new DOMParser().parseFromString(exportSvgString(d, canvasSvg, 40, aspect), 'image/svg+xml');
  const source = doc.documentElement as unknown as SVGSVGElement;
  source.querySelector('metadata')?.remove();
  const style = source.querySelector('style');
  if (style) style.textContent = await embeddedFontsCss(d);

  const natW = Number(source.getAttribute('width'));
  const natH = Number(source.getAttribute('height'));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const W = even(width);
  const H = even((width * natH) / natW);

  // Copie vivante (animée), hors écran, à la taille de la vidéo
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${W}px;height:${H}px;overflow:hidden;pointer-events:none`;
  const live = document.importNode(source, true) as SVGSVGElement;
  live.setAttribute('width', String(W));
  live.setAttribute('height', String(H));
  host.append(live);
  document.body.append(host);
  live.pauseAnimations();

  // Copie statique (sans animations) dans laquelle on fige les valeurs de chaque image
  const tmpl = live.cloneNode(true) as SVGSVGElement;
  const liveAll = [live, ...live.querySelectorAll('*')] as SVGElement[];
  const tmplAll = [tmpl, ...tmpl.querySelectorAll('*')] as SVGElement[];
  const targets = new Map<number, { opacity: boolean; dash: boolean; transform: boolean; viewBox: boolean }>();
  live.querySelectorAll(ANIMATIONS).forEach((anim) => {
    const parent = anim.parentElement as unknown as SVGElement;
    const i = liveAll.indexOf(parent);
    const flags = targets.get(i) ?? { opacity: false, dash: false, transform: false, viewBox: false };
    const attr = anim.getAttribute('attributeName');
    if (anim.tagName === 'animateMotion' || anim.tagName === 'animateTransform') flags.transform = true;
    else if (attr === 'opacity') flags.opacity = true;
    else if (attr === 'stroke-dashoffset') flags.dash = true;
    else if (attr === 'viewBox') flags.viewBox = true;
    targets.set(i, flags);
  });
  tmpl.querySelectorAll(ANIMATIONS).forEach((a) => a.remove());

  const serializer = new XMLSerializer();
  return {
    width: W,
    height: H,
    async draw(t, ctx) {
      live.setCurrentTime(t);
      for (const [i, f] of targets) {
        const el = liveAll[i];
        const out = tmplAll[i];
        if (f.opacity) out.setAttribute('opacity', getComputedStyle(el).opacity);
        if (f.dash) out.setAttribute('stroke-dashoffset', String(parseFloat(getComputedStyle(el).strokeDashoffset) || 0));
        if (f.transform) {
          // Transformation locale = CTM du parent⁻¹ × CTM de l'élément (inclut animateMotion et animateTransform)
          const g = el as unknown as SVGGraphicsElement;
          const parentCtm = (el.parentNode as unknown as SVGGraphicsElement).getCTM();
          const ctm = g.getCTM();
          if (parentCtm && ctm) {
            const m = parentCtm.inverse().multiply(ctm);
            out.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
          }
        }
        if (f.viewBox) {
          const vb = live.viewBox.animVal;
          out.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
        }
      }
      const url = URL.createObjectURL(new Blob([serializer.serializeToString(tmpl)], { type: 'image/svg+xml' }));
      try {
        const img = new Image(W, H);
        img.src = url;
        await img.decode();
        ctx.fillStyle = d.settings.background;
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    dispose() {
      host.remove();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------

export async function exportVideo(d: Diagram, canvasSvg: SVGSVGElement, opts: VideoOptions): Promise<Blob> {
  const baker = await createBaker(d, canvasSvg, opts.width, opts.aspect);
  const canvas = document.createElement('canvas');
  canvas.width = baker.width;
  canvas.height = baker.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: opts.format === 'gif' })!;
  const frames = Math.max(1, Math.round(opts.duration * opts.fps));
  const check = () => {
    if (opts.signal?.aborted) throw new DOMException('Export annulé', 'AbortError');
  };

  try {
    if (opts.format === 'gif') {
      const gif = GIFEncoder();
      for (let i = 0; i < frames; i++) {
        check();
        await baker.draw(i / opts.fps, ctx);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const palette = quantize(data, 256);
        gif.writeFrame(applyPalette(data, palette), canvas.width, canvas.height, { palette, delay: 1000 / opts.fps, repeat: 0 });
        opts.onProgress?.((i + 1) / frames);
      }
      gif.finish();
      return new Blob([gif.bytes()], { type: 'image/gif' });
    }

    const codec = await pickCodec(opts.format, canvas.width, canvas.height);
    if (!codec) throw new Error(`Encodage ${opts.format.toUpperCase()} non supporté par ce navigateur`);
    const output = new Output({
      format: opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    // Débit explicite : les schémas (traits fins sur fond uni) sont flous avec les préréglages de qualité
    const bitrate = Math.round(Math.max(2_000_000, canvas.width * canvas.height * opts.fps * 0.15));
    const source = new CanvasSource(canvas, { codec, quality: new Quality({ bitrate, bitrateMode: 'variable' }) });
    output.addVideoTrack(source, { frameRate: opts.fps });
    await output.start();
    try {
      for (let i = 0; i < frames; i++) {
        check();
        await baker.draw(i / opts.fps, ctx);
        await source.add(i / opts.fps, 1 / opts.fps);
        opts.onProgress?.((i + 1) / frames);
      }
      await output.finalize();
    } catch (err) {
      await output.cancel();
      throw err;
    }
    return new Blob([output.target.buffer!], { type: opts.format === 'mp4' ? 'video/mp4' : 'video/webm' });
  } finally {
    baker.dispose();
  }
}
