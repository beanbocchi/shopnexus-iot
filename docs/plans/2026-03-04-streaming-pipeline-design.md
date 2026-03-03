# Audio Streaming Pipeline Design

## Problem

The current system streams raw ESP32 audio directly to the browser. We need a pipeline where audio flows through processing services (noise reduction, classification) before reaching consumers.

## Pipeline Architecture

```
ESP32-CAM
  ├── Video (JPEG) ──TCP:3001──▶ Capture Service (Node.js, port 3000)
  │                                  └── WS /camera ──▶ Browser
  └── Audio (PCM)  ──TCP:3002──▶ Capture Service
                                     └── WS /audio-raw ──▶ Noise Reduction (Python, port 3010)
                                                              └── WS /audio-clean ──▶ Classification (Python, port 3020)
                                                                                        └── WS /results ──▶ Browser
```

## Decisions

- **Protocol:** WebSocket for all inter-service streaming (consistent with existing browser-facing code, easy to debug)
- **Topology:** Linear pipeline, audio only. Video path unchanged.
- **Deployment:** All services on same machine
- **Languages:** Node.js for capture, Python for ML services

## Service Table

| Service          | Port | Input                              | Output              | Language |
|------------------|------|------------------------------------|----------------------|----------|
| Capture          | 3000 | TCP from ESP32 (ports 3001, 3002)  | WS `/camera`, `/audio-raw` | Node.js  |
| Noise Reduction  | 3010 | WS client → Capture `/audio-raw`  | WS `/audio-clean`    | Python   |
| Classification   | 3020 | WS client → NoiseReduction `/audio-clean` | WS `/results` (JSON) | Python   |

## WebSocket Protocol

- **Audio services:** Binary messages containing raw 16-bit PCM, 16kHz, mono. No additional framing needed (WebSocket handles message boundaries).
- **Classification output:** JSON text messages, e.g. `{ "label": "dog_bark", "confidence": 0.92, "timestamp": 1234567 }`.
- **Connection lifecycle:** Connect to upstream, process on message, broadcast to downstream clients, reconnect with exponential backoff (2s → 4s → 8s, max 30s).

## Project Structure

```
shopnexus-iot/
├── services/
│   ├── capture/              # Current server (moved from root index.js)
│   │   ├── index.js
│   │   └── package.json
│   ├── noise-reduction/
│   │   ├── main.py
│   │   └── requirements.txt
│   └── classification/
│       ├── main.py
│       └── requirements.txt
├── client/                   # Browser app (unchanged)
├── esp32/                    # Firmware (unchanged)
└── docs/plans/
```

## Error Handling

- **Startup order doesn't matter.** Each downstream service retries upstream connection until available.
- **Mid-pipeline crash:** Downstream detects disconnect, enters reconnect loop. Upstream loses a consumer but keeps running.
- **ESP32 disconnect:** Capture service waits for reconnect (existing behavior). Downstream services idle.
- **No buffering or replay.** Audio is real-time; dropped chunks are acceptable.
- **Health checks:** Each service exposes `GET /health` returning `200 OK`.

## What Changes in Existing Code

- `index.js` moves to `services/capture/index.js`
- Existing browser-facing `/audio` WebSocket path renamed to `/audio-raw` for clarity
- Client code updated to connect to `/audio-raw` instead of `/audio`
- No changes to video path or ESP32 firmware
