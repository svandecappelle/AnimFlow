// Serveur de production : sert l'application compilée (dist/) et le relais de collaboration sur le même port.
//   npm run build && npm start        (PORT=8080 HOST=0.0.0.0 pour l'exposer)
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachCollab } from './collab.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT ?? 1234);
const host = process.env.HOST ?? 'localhost';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end("Application non compilée : lancez d'abord `npm run build`.");
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

attachCollab(server);
// Aucune autre WebSocket n'est servie ici : on ferme les demandes hors de /collab (le relais les ignore)
server.on('upgrade', (req, socket) => {
  if (!(req.url ?? '').startsWith('/collab/')) socket.destroy();
});
server.listen(port, host, () => console.log(`AnimFlow : http://${host}:${port} (collaboration sur ws://${host}:${port}/collab)`));
