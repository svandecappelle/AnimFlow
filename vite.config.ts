import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error module JavaScript du relais (sans types)
import { attachCollab } from './server/collab.mjs';

/** Relais de collaboration servi par Vite lui-même (dev et preview) : pas de second processus à lancer. */
function collabRelay(): Plugin {
  return {
    name: 'animflow-collab-relay',
    configureServer(server) {
      if (server.httpServer) attachCollab(server.httpServer);
    },
    configurePreviewServer(server) {
      attachCollab(server.httpServer);
    },
  };
}

export default defineConfig({
  plugins: [react(), collabRelay()],
  test: { environment: 'jsdom' },
} as Parameters<typeof defineConfig>[0]);
