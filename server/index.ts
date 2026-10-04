import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocketServer } from 'ws';
import { cfg, validateData } from './data';
import { Game } from './game';

const errors = validateData();
if (errors.length) {
  console.error('Data validation failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const PORT = Number(process.env.PORT) || cfg.port;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

const game = new Game();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  let alive = true;
  ws.on('pong', () => { alive = true; });
  const ping = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, 15000);
  game.onConnect(ws);
  ws.on('message', (raw) => game.onMessage(ws, raw.toString()));
  ws.on('close', () => {
    clearInterval(ping);
    game.onClose(ws);
  });
  ws.on('error', () => { /* close follows */ });
});

game.start();
server.listen(PORT, () => {
  console.log(`Survive the Bosses running at http://localhost:${PORT}`);
  console.log(`Share it with friends: cloudflared tunnel --url http://localhost:${PORT}`);
});
