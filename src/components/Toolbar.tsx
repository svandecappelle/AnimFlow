import { useStore, type Tool } from '../store';
import { icons } from './icons';

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Sélection', key: 'V' },
  { tool: 'hand', label: 'Main (déplacer la vue)', key: 'H' },
  { tool: 'rectangle', label: 'Rectangle', key: 'R' },
  { tool: 'rounded', label: 'Rectangle arrondi', key: 'U' },
  { tool: 'ellipse', label: 'Ellipse', key: 'O' },
  { tool: 'diamond', label: 'Losange', key: 'D' },
  { tool: 'arrow', label: 'Flèche / lien', key: 'A' },
  { tool: 'text', label: 'Texte', key: 'T' },
];

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.tool]));

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  return (
    <div className="toolbar panel">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={`icon-btn ${tool === t.tool ? 'active' : ''}`}
          title={`${t.label} — ${t.key}`}
          onClick={() => setTool(t.tool)}
        >
          {icons[t.tool]}
          <span className="kbd">{t.key}</span>
        </button>
      ))}
    </div>
  );
}
