# Voice Processing Pipeline Design

## Overview

Add a voice processing pipeline to the existing recording flow: when the user stops recording, the captured audio is sent through a denoise service, then speech-to-text, then styled description generation. Results (spectrograms + text) are displayed in the browser.

## Architecture

### Approach: Sequential Server-Side Pipeline

The Node.js server orchestrates the full pipeline. The browser makes a single request and receives all results.

```
User clicks Stop Recording
    |
recording.js creates WAV blob from audioChunks
    |
POST /api/process-voice (WAV file + style param)
    | (server)
    |-> saves original WAV as temp file
    |-> POST DENOISE_SERVICE/denoise (WAV) -> denoised WAV
    |-> saves denoised WAV as temp file
    |-> POST VOICE_REPHRAZE/stt (denoised WAV) -> transcription text
    |-> POST VOICE_REPHRAZE/gen (transcription + style) -> styled description
    |
Response JSON:
{
  originalAudioUrl: "/api/audio/<uuid>-original.wav",
  denoisedAudioUrl: "/api/audio/<uuid>-denoised.wav",
  transcription: "...",
  styledDescription: { original_description, style, generated_description, generated_at }
}
    |
Browser:
    |-> wavesurfer.js spectrogram: original WAV (from URL)
    |-> wavesurfer.js spectrogram: denoised WAV (from URL)
    |-> Display transcription text
    |-> Display styled description
```

## Server Changes (index.js)

### Environment Variables

- `DENOISE_SERVICE_BASE_URL` — e.g., `http://khoakomlem-internal.ddns.net:5000`
- `VOICE_REPHRAZE_BASE_URL` — e.g., `http://some-host:port`

### New Endpoints

**POST /api/process-voice**
- Accepts: `multipart/form-data` with `file` (WAV) and `style` (string) fields
- Pipeline:
  1. Save uploaded WAV to `tmp/<uuid>-original.wav`
  2. Forward WAV to `${DENOISE_SERVICE_BASE_URL}/denoise` as form-data
  3. Save response WAV to `tmp/<uuid>-denoised.wav`
  4. Forward denoised WAV to `${VOICE_REPHRAZE_BASE_URL}/stt` as form-data
  5. Call `${VOICE_REPHRAZE_BASE_URL}/gen` with JSON `{ style, product_description: transcription }`
  6. Return JSON with audio URLs + text results
- Error handling: return appropriate error if any step fails

**GET /api/styles**
- Proxies `${VOICE_REPHRAZE_BASE_URL}/styles`
- Returns array of `{ name, description }` objects

**GET /api/audio/:filename**
- Serves WAV files from the `tmp/` directory
- Content-Type: `audio/wav`

### Temp File Management

- WAV files stored in `tmp/` directory (gitignored)
- Files cleaned up on server start or after a TTL (e.g., 1 hour)

## Client Changes

### UI (index.html)

New elements added below the existing recording controls:

1. **Style dropdown** — populated from GET /api/styles, placed near record buttons
2. **Spectrogram panel** — two side-by-side wavesurfer.js instances labeled "Before (Noisy)" and "After (Denoised)"
3. **Transcription output** — read-only text area showing raw STT result
4. **Styled description output** — read-only text area showing the /gen result
5. **Loading indicator** — shown during pipeline processing

### Modified Recording Flow (recording.js)

After `stopRecording()`:
1. Still download video.webm as before
2. Instead of downloading audio.wav directly, send it to `/api/process-voice`
3. Show loading state
4. On response, render spectrograms and display text results

### New Module (client/js/voice-pipeline.js)

- `fetchStyles()` — GET /api/styles, populate dropdown
- `processVoice(wavBlob, style)` — POST /api/process-voice, return results
- `renderSpectrograms(originalUrl, denoisedUrl)` — create/update wavesurfer.js instances with spectrogram plugin
- `displayResults(transcription, styledDescription)` — update text areas

### Dependencies

- **wavesurfer.js** (CDN) — spectrogram visualization, loaded from `<script>` tag
- **wavesurfer.js spectrogram plugin** (CDN) — for spectrogram rendering

## External Service Contracts

### Denoise Service

- **POST /denoise**: `multipart/form-data` with `file` field (WAV) -> returns denoised WAV blob

### Voice Rephraze Service

- **GET /styles**: returns `[{ name, description }]`
- **POST /stt**: `multipart/form-data` with `file` field (WAV) -> `{ data: "transcription text" }`
- **POST /gen**: JSON `{ style, product_description }` -> `{ original_description, style, generated_description, generated_at }`
