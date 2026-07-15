// server.js
//
// This server now does three jobs on one port:
//  1. Serves the login page and the chat page (plain static files)
//  2. Handles POST /login — checks a rotating 6-digit code, and if correct,
//     issues a one-time "ticket" good for 60 seconds
//  3. Runs the WebSocket relay for chat — but a connection can only join a
//     room if it presents a valid, unused ticket. This is enforced here,
//     server-side — not just by hiding a link in the browser.
//
// The relay itself still never sees message content: chat text is
// encrypted in the browser (see public/chat.html) before it's ever sent.

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;

// This is the shared rotating password's seed. Set it as an environment
// variable in production (Render: Dashboard -> Environment). The fallback
// here is only for local testing — change it before deploying for real.
const SITE_SECRET = process.env.SITE_SECRET || 'dev-only-change-me';

const TIME_STEP_SECONDS = 300; // 5 minutes

function currentCounter() {
  return Math.floor(Date.now() / 1000 / TIME_STEP_SECONDS);
}

function computeCode(secret, counter) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(String(counter));
  const digest = hmac.digest();
  const num = digest.readUInt32BE(0) % 1000000;
  return String(num).padStart(6, '0');
}

// Accept current code plus one step before/after (clock-rollover tolerance).
function isValidCode(secret, code) {
  const c = currentCounter();
  return [c - 1, c, c + 1].some((cc) => computeCode(secret, cc) === code);
}

// ---------- One-time login tickets ----------
// Map<ticket, expiryTimestampMs>
const tickets = new Map();
const TICKET_TTL_MS = 60 * 1000; // must be used to open the WebSocket within 60s

function issueTicket() {
  const ticket = crypto.randomUUID();
  tickets.set(ticket, Date.now() + TICKET_TTL_MS);
  return ticket;
}

// Single-use: a ticket is deleted the moment it's checked, valid or not.
function consumeTicket(ticket) {
  const expiry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!expiry) return false;
  return Date.now() < expiry;
}

// ---------- Static file serving ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/login.html';
  const fullPath = path.join(__dirname, 'public', path.normalize(filePath));

  // Basic safety: don't allow escaping the public/ folder
  if (!fullPath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/login') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
        return;
      }
      if (parsed.code && isValidCode(SITE_SECRET, parsed.code)) {
        const ticket = issueTicket();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ticket }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid code' }));
      }
    });
    return;
  }

  serveStatic(req, res);
});

// ---------- WebSocket relay ----------
const wss = new WebSocket.Server({ server });

// rooms: Map<roomId, Set<websocket>>
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId);
}

function broadcast(roomId, msg, exclude) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(msg);
  for (const client of room) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  // Deliberately NOT reading or storing ws._socket.remoteAddress anywhere.

  let currentRoom = null;
  const clientId = crypto.randomUUID();

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }

    if (msg.type === 'join') {
      // The one and only gate: a valid, unused, unexpired ticket from /login.
      if (!msg.ticket || !consumeTicket(msg.ticket)) {
        ws.send(JSON.stringify({ type: 'auth-failed' }));
        ws.close();
        return;
      }

      currentRoom = String(msg.room || 'lobby').slice(0, 100);
      const room = getRoom(currentRoom);
      room.add(ws);
      ws.room = currentRoom;

      ws.send(JSON.stringify({ type: 'welcome', clientId }));
      broadcast(currentRoom, { type: 'peer-joined', clientId }, ws);
      return;
    }

    // Everything else (public keys, encrypted room-key deliveries, encrypted
    // chat messages) is opaque to the server — just stamp sender id and relay.
    if (currentRoom) {
      msg.clientId = clientId;
      broadcast(currentRoom, msg, ws);
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(ws);
      broadcast(currentRoom, { type: 'peer-left', clientId }, ws);
      if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (SITE_SECRET === 'dev-only-change-me') {
    console.log('WARNING: using the default SITE_SECRET. Set your own via the SITE_SECRET environment variable before deploying.');
  }
});
