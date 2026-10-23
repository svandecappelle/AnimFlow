import { useEffect, useMemo, useRef, useState } from 'react';
import { sequenceCycle } from '../animation';
import { download } from '../io/files';
import { defaultVideoDuration, exportVideo, supportedFormats, type VideoFormat } from '../io/video';
import { getCanvasSvg, useStore } from '../store';
import { fileSlug } from '../workspace';
import { currentDocName } from '../workspaceActions';

const SIZES: Record<VideoFormat, { label: string; width: number }[]> = {
  mp4: [
    { label: '720p (1280 px)', width: 1280 },
    { label: '1080p (1920 px)', width: 1920 },
    { label: '4K (3840 px)', width: 3840 },
  ],
  webm: [
    { label: '720p (1280 px)', width: 1280 },
    { label: '1080p (1920 px)', width: 1920 },
  ],
  gif: [
    { label: 'Petit (640 px)', width: 640 },
    { label: 'Moyen (960 px)', width: 960 },
    { label: 'Grand (1280 px)', width: 1280 },
  ],
};
const FPS: Record<VideoFormat, number[]> = { mp4: [24, 30, 60], webm: [24, 30, 60], gif: [10, 15, 20] };
const LABELS: Record<VideoFormat, string> = { mp4: 'MP4', webm: 'WebM', gif: 'GIF animé' };
const CODECS: Record<string, string> = { avc: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', gif: '' };

export function VideoDialog({ onClose }: { onClose: () => void }) {
  const diagram = useStore((s) => s.diagram);
  const [formats, setFormats] = useState<{ format: VideoFormat; codec: string }[] | null>(null);
  const [format, setFormat] = useState<VideoFormat>('mp4');
  const [width, setWidth] = useState(1280);
  const [fps, setFps] = useState(30);
  const cycle = diagram.settings.sequence ? sequenceCycle(diagram) : 0;
  const [cycles, setCycles] = useState(1);
  const [freeDuration, setFreeDuration] = useState(() => defaultVideoDuration(diagram));
  const cameraOn = diagram.settings.sequence && diagram.settings.camera !== 'off';
  const [aspect, setAspect] = useState<number>(cameraOn ? 16 / 9 : 0);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const duration = diagram.settings.sequence ? Math.round(cycle * cycles * 10) / 10 : freeDuration;

  useEffect(() => {
    void supportedFormats().then((f) => {
      setFormats(f);
      if (!f.some((x) => x.format === 'mp4')) chooseFormat(f[0].format);
    });
    return () => abort.current?.abort();
  }, []);

  const chooseFormat = (f: VideoFormat) => {
    setFormat(f);
    setWidth(SIZES[f][0].width);
    setFps(f === 'gif' ? 15 : 30);
  };

  const estimate = useMemo(() => Math.round(duration * fps), [duration, fps]);

  const run = async () => {
    const svg = getCanvasSvg();
    if (!svg) return;
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const blob = await exportVideo(diagram, svg, { format, width, fps, duration, aspect: aspect || undefined, onProgress: setProgress, signal: abort.current.signal });
      download(`${fileSlug(currentDocName())}.${format}`, blob);
      onClose();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
      setProgress(null);
    }
  };

  const busy = progress !== null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal panel" onKeyDown={(e) => e.stopPropagation()}>
        <h2>Exporter en vidéo</h2>
        <p className="muted">
          Rendu image par image de l’animation
          {diagram.settings.sequence && diagram.settings.camera !== 'off' ? ', caméra de suivi comprise' : ''}. La vidéo est calculée
          dans le navigateur, rien n’est envoyé sur un serveur.
        </p>
        {!formats ? (
          <p className="muted">Détection des formats disponibles…</p>
        ) : (
          <div className="form-grid">
            <label>
              Format
              <select value={format} disabled={busy} onChange={(e) => chooseFormat(e.target.value as VideoFormat)}>
                {formats.map((f) => (
                  <option key={f.format} value={f.format}>
                    {LABELS[f.format]}
                    {CODECS[f.codec] ? ` (${CODECS[f.codec]})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Taille
              <select value={width} disabled={busy} onChange={(e) => setWidth(Number(e.target.value))}>
                {SIZES[format].map((s) => (
                  <option key={s.width} value={s.width}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Format d’image
              <select value={aspect} disabled={busy} onChange={(e) => setAspect(Number(e.target.value))}>
                <option value={16 / 9}>16:9 (vidéo)</option>
                <option value={1}>Carré</option>
                <option value={0}>Proportions du schéma</option>
              </select>
            </label>
            <label>
              Images par seconde
              <select value={fps} disabled={busy} onChange={(e) => setFps(Number(e.target.value))}>
                {FPS[format].map((f) => (
                  <option key={f} value={f}>
                    {f} i/s
                  </option>
                ))}
              </select>
            </label>
            {diagram.settings.sequence ? (
              <label>
                Nombre de cycles ({cycle.toFixed(1)} s chacun)
                <select value={cycles} disabled={busy} onChange={(e) => setCycles(Number(e.target.value))}>
                  {[1, 2, 3, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} — {(cycle * n).toFixed(1)} s
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Durée (s)
                <input
                  type="number"
                  min={1}
                  max={120}
                  step={0.5}
                  value={freeDuration}
                  disabled={busy}
                  onChange={(e) => setFreeDuration(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                />
              </label>
            )}
          </div>
        )}
        <p className="muted">
          {estimate} images à calculer
          {format === 'gif' ? ' — le GIF boucle à l’infini, idéal pour un wiki ou un README.' : '.'}
          {formats?.find((f) => f.format === 'mp4')?.codec === 'av1' && format === 'mp4'
            ? ' Ce navigateur encode le MP4 en AV1 (pas de H.264 disponible) : lisible dans les navigateurs récents et VLC.'
            : ''}
        </p>
        {busy && (
          <div className="progress-bar">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>{Math.round(progress * 100)} %</span>
          </div>
        )}
        {error && <p className="error">Export impossible : {error}</p>}
        <div className="modal-actions">
          {busy ? (
            <button className="btn" onClick={() => abort.current?.abort()}>
              Annuler l’export
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                Fermer
              </button>
              <button className="btn primary" disabled={!formats} onClick={() => void run()}>
                Exporter
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
