import { useStore } from '../store';
import { OrderPanel } from './OrderPanel';
import { PropertiesPanel } from './PropertiesPanel';

/** Panneau de droite : propriétés de la sélection, ou ordre des étapes de l'animation. */
export function RightPanel() {
  const tab = useStore((s) => s.rightTab);
  const setTab = useStore((s) => s.setRightTab);
  return (
    <aside className="props panel">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'props'} className={tab === 'props' ? 'active' : ''} onClick={() => setTab('props')}>
          Propriétés
        </button>
        <button role="tab" aria-selected={tab === 'order'} className={tab === 'order' ? 'active' : ''} onClick={() => setTab('order')} title="Ordre des étapes — L">
          Ordre des étapes
        </button>
      </div>
      {tab === 'props' ? <PropertiesPanel /> : <OrderPanel />}
    </aside>
  );
}
