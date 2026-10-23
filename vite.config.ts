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

/**
 * Noms d'hôte autorisés (Vite refuse par défaut ceux qu'il ne connaît pas). Hôtes de l'équipe + variable
 * ALLOWED_HOSTS (séparés par des virgules, ou « all » pour tout autoriser), par exemple :
 *   ALLOWED_HOSTS=mon-hote.example.com npm run dev -- --host
 */
const DEFAULT_ALLOWED_HOSTS = ['localhost'];
const extraHosts = (process.env.ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);
const allowedHosts: string[] | true = extraHosts.includes('all') ? true : [...DEFAULT_ALLOWED_HOSTS, ...extraHosts];

export default defineConfig({
  plugins: [react(), collabRelay()],
  server: { allowedHosts },
  preview: { allowedHosts },
  test: { environment: 'jsdom' },
} as Parameters<typeof defineConfig>[0]);
