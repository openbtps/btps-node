import { createServer, TLSSocket } from 'tls';
import fs from 'fs';
import readline from 'readline';

let peerSocket: TLSSocket | null = null;

const server = createServer(
  {
    cert: fs.readFileSync('certs/b.server.crt'),
    key: fs.readFileSync('certs/b.server.key'),
  },
  (socket) => {
    console.log('[B] Incoming connection from', socket.remoteAddress);
    peerSocket = socket;

    socket.on('data', (data) => {
      console.log('[B] Received from A:', data.toString().trim());
    });

    socket.on('error', (err) => {
      console.error('[B] Socket error:', err);
    });

    // Enable chat input for B
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.on('line', (line) => {
      if (peerSocket && !peerSocket.destroyed) {
        peerSocket.write(line);
      } else {
        console.log('[B] No active peer connection');
      }
    });
  },
);

server.listen(4443, () => {
  console.log('[B] Listening on btps://localhost:4443');
});
