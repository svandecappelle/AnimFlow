import { useState } from 'react';
import { getUser, newRoomId, setUser, shareLink, stopSession } from '../collab';
import { useStore } from '../store';
import { setDocRoom, shareCurrentDocument } from '../workspaceActions';

const STATUS: Record<string, string> = {
  connecting: 'Connexion au serveur…',
  connected: 'Connecté',
  disconnected: 'Déconnecté — nouvelle tentative en cours…',
};

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const collab = useStore((s) => s.collab);
  const peers = useStore((s) => s.peers);
  const docRoom = useStore((s) => s.workspaces.flatMap((w) => w.docs).find((m) => m.id === s.currentDocId)?.room);
  const [user, setLocalUser] = useState(getUser);
  const [copied, setCopied] = useState(false);

  const rename = (name: string) => {
    const next = { ...user, name: name.slice(0, 32) };
    setLocalUser(next);
    if (next.name.trim()) setUser(next);
  };

  const copy = (link: string) => {
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel" onKeyDown={(e) => e.stopPropagation()}>
        <h2>Collaboration en direct</h2>
        <div className="form-grid">
          <label>
            Votre nom (visible des autres)
            <input className="text-input" value={user.name} onChange={(e) => rename(e.target.value)} />
          </label>
          <label>
            Votre couleur
            <input type="color" className="color-input wide" value={user.color} onChange={(e) => (setLocalUser({ ...user, color: e.target.value }), setUser({ ...user, color: e.target.value }))} />
          </label>
        </div>

        {!collab ? (
          <>
            <p className="muted">
              Démarrez une session pour modifier ce document à plusieurs en temps réel. Toute personne disposant du lien peut le voir
              et le modifier ; chacun garde une copie dans ses documents.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                Fermer
              </button>
              {docRoom && (
                <button className="btn" onClick={() => shareCurrentDocument(docRoom)} title="Reprendre la salle déjà associée à ce document">
                  Reprendre la session précédente
                </button>
              )}
              <button className="btn primary" onClick={() => shareCurrentDocument(newRoomId())}>
                Démarrer une session
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="share-link">
              <input readOnly value={shareLink(collab.room)} onFocus={(e) => e.target.select()} />
              <button className="btn primary" onClick={() => copy(shareLink(collab.room))}>
                {copied ? 'Copié ✓' : 'Copier le lien'}
              </button>
            </div>
            <p className={collab.status === 'connected' ? 'muted' : 'error'}>
              <span className={`status-dot ${collab.status}`} /> {STATUS[collab.status]}
            </p>
            <div className="peer-list">
              <div className="peer">
                <span className="avatar" style={{ background: user.color }}>
                  {user.name.trim().charAt(0).toUpperCase() || '?'}
                </span>
                {user.name} (vous)
              </div>
              {peers.map((p) => (
                <div className="peer" key={p.clientId}>
                  <span className="avatar" style={{ background: p.color }}>
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  {p.name}
                </div>
              ))}
              {!peers.length && <p className="muted">Personne d’autre pour l’instant : envoyez le lien.</p>}
            </div>
            <p className="muted">
              Annuler (Ctrl+Z) n’annule que vos propres modifications. Le serveur ne conserve la session que tant qu’un participant
              est connecté.
            </p>
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => {
                  stopSession();
                  setDocRoom(useStore.getState().currentDocId, undefined);
                }}
                title="Quitter et oublier la salle pour ce document"
              >
                Quitter et dissocier
              </button>
              <button className="btn" onClick={() => stopSession()}>
                Quitter la session
              </button>
              <button className="btn primary" onClick={onClose}>
                Continuer
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
