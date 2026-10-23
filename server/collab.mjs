// Relais de collaboration temps réel (protocole y-websocket : synchronisation Yjs + présence).
// Chaque salle `/collab/<salle>` partage un document Yjs entre ses participants. Le contenu n'est gardé en mémoire
// que tant qu'au moins un participant est connecté : chaque navigateur conserve sa propre copie locale.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocketServer } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

export const COLLAB_PATH = '/collab';
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const PING_INTERVAL = 30_000;

/** @type {Map<string, Room>} */
const rooms = new Map();

class Room {
  constructor(name) {
    this.name = name;
    this.doc = new Y.Doc();
    /** connexion → identifiants de présence qu'elle a déclarés */
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.awareness.on('update', ({ added, updated, removed }, conn) => {
      const ids = conn ? this.conns.get(conn) : null;
      if (ids) {
        added.forEach((id) => ids.add(id));
        removed.forEach((id) => ids.delete(id));
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
      this.broadcast(encoding.toUint8Array(enc));
    });
    this.doc.on('update', (update) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc));
    });
  }

  broadcast(message) {
    for (const conn of this.conns.keys()) send(this, conn, message);
  }
}

function send(room, conn, message) {
  if (conn.readyState !== conn.OPEN) {
    leave(room, conn);
    return;
  }
  conn.send(message, (err) => err && leave(room, conn));
}

function leave(room, conn) {
  const ids = room.conns.get(conn);
  if (!ids) return;
  room.conns.delete(conn);
  awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], null);
  if (room.conns.size === 0) {
    room.doc.destroy();
    rooms.delete(room.name);
  }
  conn.close();
}

function onMessage(room, conn, data) {
  try {
    const dec = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(dec);
    if (type === MESSAGE_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(dec, enc, room.doc, conn);
      if (encoding.length(enc) > 1) send(room, conn, encoding.toUint8Array(enc));
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), conn);
    }
  } catch (err) {
    console.error('[collab] message invalide', err);
  }
}

function join(conn, roomName) {
  let room = rooms.get(roomName);
  if (!room) rooms.set(roomName, (room = new Room(roomName)));
  room.conns.set(conn, new Set());
  conn.binaryType = 'arraybuffer';
  conn.on('message', (data) => onMessage(room, conn, data));
  conn.on('close', () => leave(room, conn));

  // Détection des connexions mortes
  let alive = true;
  conn.on('pong', () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) {
      leave(room, conn);
      clearInterval(ping);
      return;
    }
    alive = false;
    try {
      conn.ping();
    } catch {
      leave(room, conn);
      clearInterval(ping);
    }
  }, PING_INTERVAL);
  conn.on('close', () => clearInterval(ping));

  // Étape 1 de la synchronisation + présence des autres participants
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, room.doc);
  send(room, conn, encoding.toUint8Array(enc));
  const states = room.awareness.getStates();
  if (states.size) {
    const aw = encoding.createEncoder();
    encoding.writeVarUint(aw, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
    send(room, conn, encoding.toUint8Array(aw));
  }
}

/** Ajoute le relais WebSocket à un serveur HTTP existant (Vite ou serveur autonome). */
export function attachCollab(httpServer, path = COLLAB_PATH) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(`${path}/`)) return; // autres WebSockets (ex. rechargement à chaud de Vite)
    const room = decodeURIComponent(url.pathname.slice(path.length + 1));
    if (!/^[\w-]{1,128}$/.test(room)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => join(ws, room));
  });
  return wss;
}
