// @vitest-environment node
/// <reference types="node" />
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
// @ts-expect-error module JavaScript du relais (sans types)
import { attachCollab } from './collab.mjs';

let server: http.Server;
let url: string;

beforeAll(async () => {
  server = http.createServer();
  attachCollab(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/collab`;
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise<void>((r) => server.close(() => r()));
});

function client(room: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(url, room, doc, { WebSocketPolyfill: WebSocket as never, disableBc: true });
  const synced = new Promise<void>((r) => provider.once('sync', () => r()));
  return { doc, provider, synced };
}
const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('relais de collaboration', () => {
  it('synchronise deux clients et leur présence, salle par salle', async () => {
    const a = client('salle-1');
    await a.synced;
    a.doc.getMap('nodes').set('n1', { id: 'n1', label: 'depuis A' });
    const b = client('salle-1');
    await b.synced;
    await until(() => b.doc.getMap('nodes').size === 1);
    expect((b.doc.getMap('nodes').get('n1') as { label: string }).label).toBe('depuis A');

    b.doc.getMap('nodes').set('n2', { id: 'n2', label: 'depuis B' });
    await until(() => a.doc.getMap('nodes').size === 2);

    b.provider.awareness.setLocalStateField('user', { name: 'Bob' });
    await until(() => [...a.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Bob'));

    // une autre salle est isolée
    const c = client('salle-2');
    await c.synced;
    expect(c.doc.getMap('nodes').size).toBe(0);

    // un départ retire la présence chez les autres
    b.provider.destroy();
    await until(() => ![...a.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Bob'));
    a.provider.destroy();
    c.provider.destroy();
  });

  it('refuse les noms de salle invalides', async () => {
    const ws = new WebSocket(`${url}/nom%20invalide!`);
    await new Promise<void>((r) => {
      ws.on('error', () => r());
      ws.on('close', () => r());
    });
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
