/**
 * Collaboration temps réel (Yjs + relais y-websocket).
 *
 * Le schéma est répliqué dans un document Yjs : deux Y.Map (`nodes`, `edges`, élément par identifiant) et une Y.Map
 * `settings`. La granularité est l'élément (comme Excalidraw) : deux personnes peuvent modifier des éléments
 * différents en même temps ; sur un même élément, la dernière modification l'emporte. L'ordre d'affichage est
 * conservé via un rang `_i` attribué à la création de l'élément.
 *
 * - local → distant : chaque nouvelle version du diagramme dans le store est comparée à la précédente, seuls les
 *   éléments modifiés (nouvel objet, grâce à l'immuabilité) sont envoyés ;
 * - distant → local : toute transaction non locale reconstruit le diagramme (les objets inchangés gardent leur
 *   identité, donc pas de re-rendu inutile) ;
 * - annuler / rétablir : Y.UndoManager limité aux modifications locales ;
 * - présence (awareness) : nom, couleur, curseur et sélection de chacun.
 */
import { useStore } from './store';

const USER_KEY = 'animflow:user';
const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#c2255c', '#5f3dc4'];

export interface User {
  name: string;
  color: string;
}

export function getUser(): User {
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as User | null;
    if (u?.name && u.color) return u;
  } catch {
    // valeur corrompue : on en recrée une
  }
  const user = { name: `Invité ${Math.floor(Math.random() * 900 + 100)}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  setUser(user);
  return user;
}

export function setUser(user: User) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // sans importance
  }
  engine?.setUser(user);
}

/** URL du relais : variable VITE_COLLAB_URL, sinon `/collab` sur le même serveur que l'application. */
export function collabUrl(): string {
  const env = import.meta.env.VITE_COLLAB_URL as string | undefined;
  if (env) return env;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/collab`;
}

export const newRoomId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);

export function roomFromHash(hash = location.hash): string | null {
  const m = /[#&]room=([\w-]{1,128})/.exec(hash);
  return m ? m[1] : null;
}

export const shareLink = (room: string) => `${location.origin}${location.pathname}#room=${room}`;

// Le moteur (Yjs + WebSocket) n'est chargé qu'au démarrage d'une session
type Engine = typeof import('./collabEngine');
let engine: Engine | null = null;
let active = false;

export const isCollaborating = () => active;

/**
 * Rejoint (ou crée) une salle pour le document ouvert. Si la salle est vide, le document local y est publié ;
 * sinon le document local prend le contenu de la salle.
 */
export function startSession(room: string) {
  stopSession();
  active = true;
  useStore.getState().setCollab({ room, status: 'connecting', canUndo: false, canRedo: false });
  void import('./collabEngine').then((mod) => {
    engine = mod;
    // Session arrêtée (ou remplacée) pendant le chargement du moteur
    if (active && useStore.getState().collab?.room === room) mod.start(room, getUser(), stopSession);
  });
}

export function stopSession() {
  if (!active) return;
  active = false;
  const room = useStore.getState().collab?.room;
  engine?.stop();
  // L'historique local ne correspond plus au contenu (modifications des autres) : on repart de zéro
  useStore.setState({ past: [], future: [] });
  useStore.getState().setCollab(null);
  if (room && roomFromHash() === room) history.replaceState(null, '', location.pathname + location.search);
}

/** Diffuse la position du curseur (coordonnées du schéma), au plus une fois par image. */
export function updateCursor(p: { x: number; y: number } | null) {
  if (active) engine?.updateCursor(p);
}
