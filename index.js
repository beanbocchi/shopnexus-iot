import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
app.use(express.json());
const upload = multer({ dest: 'tmp/' });

// --- WEBSOCKET SERVERS for Browser Clients ---
const wssAudio = new WebSocketServer({ noServer: true });
const wssCamera = new WebSocketServer({ noServer: true });

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

app.get('/api/styles', async (req, res) => {
    try {
        const response = await fetch(`${process.env.VOICE_REPHRAZE_BASE_URL}/styles`);
        const styles = await response.json();
        res.json(styles);
    } catch (err) {
        console.error('Styles proxy error:', err);
        res.status(502).json({ error: 'Failed to fetch styles' });
    }
});

app.get('/api/audio/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'tmp', req.params.filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Type', 'audio/wav');
    fs.createReadStream(filePath).pipe(res);
});

app.post('/api/process-voice', upload.single('file'), async (req, res) => {
    const id = crypto.randomUUID();
    const originalPath = path.join(__dirname, 'tmp', `${id}-original.wav`);
    const denoisedPath = path.join(__dirname, 'tmp', `${id}-denoised.wav`);

    try {
        // Rename uploaded file to original
        fs.renameSync(req.file.path, originalPath);

        // Step 1: Denoise
        const denoiseForm = new FormData();
        const originalBuffer = fs.readFileSync(originalPath);
        denoiseForm.append('file', new Blob([originalBuffer], { type: 'audio/wav' }), 'audio.wav');

        const denoiseRes = await fetch(`${process.env.DENOISE_SERVICE_BASE_URL}/denoise`, {
            method: 'POST',
            body: denoiseForm,
        });

        if (!denoiseRes.ok) {
            throw new Error(`Denoise service error: ${denoiseRes.status}`);
        }

        const denoisedBuffer = Buffer.from(await denoiseRes.arrayBuffer());
        fs.writeFileSync(denoisedPath, denoisedBuffer);

        // Step 2: STT
        const sttForm = new FormData();
        sttForm.append('file', new Blob([denoisedBuffer], { type: 'audio/wav' }), 'audio.wav');

        const sttRes = await fetch(`${process.env.VOICE_REPHRAZE_BASE_URL}/stt`, {
            method: 'POST',
            body: sttForm,
        });

        if (!sttRes.ok) {
            throw new Error(`STT service error: ${sttRes.status}`);
        }

        const sttData = await sttRes.json();
        const transcription = sttData.data;

        // Step 3: Generate styled description
        const style = req.body?.style || req.query?.style;
        let styledDescription = null;

        if (style) {
            const genRes = await fetch(`${process.env.VOICE_REPHRAZE_BASE_URL}/gen`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ style, product_description: transcription }),
            });

            if (genRes.ok) {
                styledDescription = await genRes.json();
            }
        }

        res.json({
            originalAudioUrl: `/api/audio/${id}-original.wav`,
            denoisedAudioUrl: `/api/audio/${id}-denoised.wav`,
            transcription,
            styledDescription,
        });
    } catch (err) {
        console.error('Voice pipeline error:', err);
        res.status(500).json({ error: err.message });
    }
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Web Server running on http://0.0.0.0:3000');
});
