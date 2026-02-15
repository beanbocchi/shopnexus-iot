const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const path = require('path');

const app = express();
const server = http.createServer(app);

// --- WEBSOCKET SERVERS for Browser Clients ---
const wssAudio = new WebSocket.Server({ noServer: true });
const wssCamera = new WebSocket.Server({ noServer: true });

// --- TCP SERVERS for ESP32 ---
let esp32CamSocket = null;

const tcpCamera = net.createServer((socket) => {
    console.log('ESP32 Camera Stream connected');
    esp32CamSocket = socket;

    let chunks = [];
    let chunksLen = 0;
    let expectedLen = 0;
    let headerBuf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
        let offset = 0;

        while (offset < chunk.length) {
            // Read 4-byte length header
            if (expectedLen === 0) {
                const need = 4 - headerBuf.length;
                const available = chunk.length - offset;
                const take = Math.min(need, available);

                headerBuf = Buffer.concat([headerBuf, chunk.slice(offset, offset + take)]);
                offset += take;

                if (headerBuf.length === 4) {
                    expectedLen = headerBuf.readUInt32LE(0);
                    headerBuf = Buffer.alloc(0);
                    chunks = [];
                    chunksLen = 0;
                }
                continue;
            }

            // Collect JPEG data
            const remaining = expectedLen - chunksLen;
            const available = chunk.length - offset;
            const take = Math.min(remaining, available);

            chunks.push(chunk.slice(offset, offset + take));
            chunksLen += take;
            offset += take;

            if (chunksLen === expectedLen) {
                const data = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);

                // Check for settings response (magic 0xBEEF)
                if (data.length >= 2 && data[0] === 0xBE && data[1] === 0xEF) {
                    const settings = {};
                    for (let i = 2; i < data.length; i += 2) {
                        settings[data[i]] = data.readInt8(i + 1);
                    }
                    const json = JSON.stringify({ type: 'settings', data: settings });
                    wssCamera.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(json);
                        }
                    });
                } else {
                    // Regular JPEG frame
                    wssCamera.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(data);
                        }
                    });
                }

                expectedLen = 0;
                chunks = [];
                chunksLen = 0;
            }
        }
    });

    socket.on('error', (err) => console.error('Cam TCP Error:', err));
    socket.on('close', () => {
        console.log('ESP32 Camera disconnected');
        esp32CamSocket = null;
    });
});

// Handle WS Commands from Browser
wssCamera.on('connection', (ws) => {
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (esp32CamSocket && data.id !== undefined) {
                // Generic protocol: 0xA5 + ID + Value
                const buf = Buffer.alloc(3);
                buf[0] = 0xA5;
                buf[1] = data.id;
                buf.writeInt8(data.val, 2);
                esp32CamSocket.write(buf);
                console.log('CMD ->', data);
            }
        } catch (e) {
            console.error('WS Cmd Error:', e);
        }
    });
});

const tcpAudio = net.createServer((socket) => {
    console.log('ESP32 Audio Stream connected');
    
    let audioBuf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
        // Append to buffer
        audioBuf = Buffer.concat([audioBuf, chunk]);

        // We need even number of bytes for 16-bit PCM
        const len = audioBuf.length;
        const remainder = len % 2;
        
        if (len - remainder > 0) {
            const toSend = audioBuf.slice(0, len - remainder);
            
            // Broadcast valid PCM chunks
            wssAudio.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(toSend);
                }
            });

            // Keep remainder (0 or 1 byte) for next chunk
            if (remainder > 0) {
                audioBuf = audioBuf.slice(len - remainder);
            } else {
                audioBuf = Buffer.alloc(0);
            }
        }
    });

    socket.on('error', (err) => console.error('Audio TCP Error:', err));
});

// Start TCP Servers
tcpCamera.listen(3001, '0.0.0.0', () => console.log('TCP Camera listening on :3001'));
tcpAudio.listen(3002, '0.0.0.0', () => console.log('TCP Audio listening on :3002'));


// --- HTTP & WS SETUP ---
server.on('upgrade', (req, socket, head) => {
    const pathname = req.url;
    if (pathname === '/audio') {
        wssAudio.handleUpgrade(req, socket, head, (ws) => wssAudio.emit('connection', ws, req));
    } else if (pathname === '/camera') {
        wssCamera.handleUpgrade(req, socket, head, (ws) => wssCamera.emit('connection', ws, req));
    } else {
        socket.destroy();
    }
});

app.use(express.static(path.join(__dirname, 'client')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Web Server running on http://0.0.0.0:3000');
});
