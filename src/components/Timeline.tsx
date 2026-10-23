import { useEffect, useRef } from 'react';
import { sequenceCycle } from '../animation';
import { getCanvasSvg, useStore } from '../store';

/** Barre de progression du cycle en mode séquence ; cliquer pour se positionner dans le temps. */
export function Timeline() {
  const diagram = useStore((s) => s.diagram);
  const barRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const cycle = sequenceCycle(diagram);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const svg = getCanvasSvg();
      if (svg && barRef.current && labelRef.current) {
        const t = svg.getCurrentTime() % cycle;
        barRef.current.style.width = `${(t / cycle) * 100}%`;
        labelRef.current.textContent = `${t.toFixed(1)} / ${cycle.toFixed(1)} s`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cycle]);

  const markers = diagram.edges.filter((e) => e.animation.type !== 'none');

  return (
    <div className="timeline panel">
      <div
        className="track"
        onClick={(e) => {
          const svg = getCanvasSvg();
          if (!svg) return;
          const r = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width;
          const now = svg.getCurrentTime();
          svg.setCurrentTime(now - (now % cycle) + frac * cycle);
        }}
      >
        {markers.map((e) => (
          <div
            key={e.id}
            className="marker"
            title={e.label || 'lien'}
            style={{
              left: `${(e.animation.delay / cycle) * 100}%`,
              width: `${(Math.min(e.animation.duration, cycle - e.animation.delay) / cycle) * 100}%`,
              background: e.animation.color ?? e.strokeColor,
            }}
          />
        ))}
        <div className="progress" ref={barRef} />
      </div>
      <span className="time" ref={labelRef} />
    </div>
  );
}
