import { createServer, TLSSocket } from 'tls';
import fs from 'fs';
import tls from 'tls';
import readline from 'readline';

let peerSocket: TLSSocket | null = null;

const server = createServer(
  {
    cert: fs.readFileSync('certs/a.server.crt'),
    key: fs.readFileSync('certs/a.server.key'),
  },
  (socket) => {
    console.log('[A] Incoming connection from', socket.remoteAddress);
    socket.on('data', (data) => {
      console.log('[A] Received from B:', data.toString().trim());
    });
  },
);

server.listen(3443, () => {
  console.log('[A] Listening on btps://localhost:3443');

  const client = tls.connect(4443, 'localhost', { rejectUnauthorized: false }, () => {
    console.log('[A] Connected to B');
    peerSocket = client;
    peerSocket.write('Hello B, this is A!');
  });

  client.on('data', (data) => {
    console.log('[A] Got reply from B:', data.toString().trim());
  });

  client.on('error', (err) => {
    console.error('[A] Client error:', err);
  });

  // Enable interactive chat
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', (line) => {
    if (peerSocket && !peerSocket.destroyed) {
      peerSocket.write(line);
    } else {
      console.log('[A] No active peer connection');
    }
  });
});
