# Voice Processing Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the user stops recording, send audio through denoise → STT → styled description generation, displaying spectrograms (before/after) and results in the browser.

**Architecture:** Node.js server proxies all external service calls (denoise, STT, gen). Browser sends WAV to a single `/api/process-voice` endpoint, receives audio URLs + text results. wavesurfer.js renders spectrograms from temp file URLs.

**Tech Stack:** Express (existing), wavesurfer.js v7 (CDN ESM import), Bun runtime

---

### Task 1: Server — Add tmp directory and .gitignore entry

**Files:**
- Modify: `.gitignore`

**Step 1: Add tmp/ to .gitignore**

Append to `.gitignore`:
```
tmp/
```

**Step 2: Create tmp directory**

Run: `mkdir -p tmp`

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add tmp/ to gitignore for voice pipeline temp files"
```

---

### Task 2: Server — Add /api/styles proxy endpoint

**Files:**
- Modify: `index.js` (after line 173, before `server.listen`)

**Step 1: Add the styles proxy route**

Add after `app.get('/', ...)` and before `server.listen(...)`:

```javascript
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
```

**Step 2: Test manually**

Run: `VOICE_REPHRAZE_BASE_URL=http://your-host bun run index.js`
Then: `curl http://localhost:3000/api/styles`
Expected: JSON array of styles from the upstream service

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat: add /api/styles proxy endpoint"
```

---

### Task 3: Server — Add /api/audio/:filename static serving

**Files:**
- Modify: `index.js`

**Step 1: Add static serving for temp audio files**

Add these imports at the top of `index.js`:

```javascript
import fs from 'fs';
```

Add route after the `/api/styles` route:

```javascript
app.get('/api/audio/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'tmp', req.params.filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Type', 'audio/wav');
    fs.createReadStream(filePath).pipe(res);
});
```

**Step 2: Test manually**

Place a test `.wav` in `tmp/` and curl: `curl -I http://localhost:3000/api/audio/test.wav`
Expected: 200 with `Content-Type: audio/wav`

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat: add /api/audio/:filename endpoint to serve temp WAV files"
```

---

### Task 4: Server — Add POST /api/process-voice pipeline endpoint

**Files:**
- Modify: `index.js`

**Step 1: Install multer for multipart parsing**

Run: `bun add multer`

Note: Express 5 does not have built-in multipart parsing. Multer handles `multipart/form-data`.

**Step 2: Add multer import and config**

Add at the top of `index.js`:

```javascript
import multer from 'multer';
import crypto from 'crypto';
```

Add after the existing `const app = express();` line:

```javascript
const upload = multer({ dest: 'tmp/' });
```

**Step 3: Add the process-voice endpoint**

Add after the `/api/audio/:filename` route:

```javascript
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
```

**Step 4: Add JSON body parsing middleware**

Add after `const app = express();`:

```javascript
app.use(express.json());
```

**Step 5: Test manually**

Run server with env vars:
```bash
DENOISE_SERVICE_BASE_URL=http://khoakomlem-internal.ddns.net:5000 \
VOICE_REPHRAZE_BASE_URL=http://your-host \
bun run index.js
```

Test with curl:
```bash
curl -X POST http://localhost:3000/api/process-voice \
  -F "file=@test.wav" \
  -F "style=văn minh"
```

Expected: JSON with `originalAudioUrl`, `denoisedAudioUrl`, `transcription`, `styledDescription`

**Step 6: Commit**

```bash
git add index.js package.json bun.lock
git commit -m "feat: add /api/process-voice pipeline endpoint (denoise -> STT -> gen)"
```

---

### Task 5: Client — Add voice pipeline UI elements to index.html

**Files:**
- Modify: `client/index.html`

**Step 1: Add wavesurfer.js CDN import**

Before the closing `</body>` tag (before the `<script type="module">` tag), there's no need — wavesurfer.js will be imported as ESM in the JS module.

**Step 2: Add style selector after recording controls**

Insert after the recording controls `<div>` (after line 66's closing `</div>`, inside the camera panel):

```html
<!-- Voice Pipeline Controls -->
<div class="mt-[15px] flex gap-2.5 items-center">
    <label class="text-xs text-gray-400">Style:</label>
    <select id="styleSelect"
        class="flex-1 px-1.5 py-1.5 bg-white/10 text-[#e0e6f0] border border-white/20 rounded-md text-sm">
        <option value="">Loading styles...</option>
    </select>
</div>
```

**Step 3: Add voice pipeline results panel**

Insert after the Audio panel's closing `</div>` (after line 127), as a new full-width row:

```html
<!-- Voice Pipeline Results -->
<div id="voicePipelineResults" class="hidden bg-white/[0.03] border border-white/[0.06] rounded-xl p-3.5">
    <h2 class="text-[15px] mb-2.5 text-blue-400 flex items-center gap-2">
        🔊 Voice Processing Results
    </h2>

    <!-- Loading indicator -->
    <div id="voicePipelineLoading" class="hidden text-center py-8">
        <div class="inline-block w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
        <p class="mt-2 text-sm text-gray-400" id="voicePipelineStatus">Processing...</p>
    </div>

    <!-- Spectrograms -->
    <div id="spectrogramContainer" class="hidden">
        <div class="grid grid-cols-2 gap-4 mb-4">
            <div>
                <h3 class="text-xs text-gray-400 mb-1">Before (Noisy)</h3>
                <div id="spectrogramOriginal" class="bg-black rounded-lg overflow-hidden"></div>
            </div>
            <div>
                <h3 class="text-xs text-gray-400 mb-1">After (Denoised)</h3>
                <div id="spectrogramDenoised" class="bg-black rounded-lg overflow-hidden"></div>
            </div>
        </div>

        <!-- Transcription -->
        <div class="mb-3">
            <label class="text-xs text-gray-400 block mb-1">Transcription (STT)</label>
            <div id="transcriptionOutput"
                class="w-full p-2.5 bg-white/5 border border-white/10 rounded-lg text-sm min-h-[40px]"></div>
        </div>

        <!-- Styled Description -->
        <div id="styledDescriptionContainer" class="hidden">
            <label class="text-xs text-gray-400 block mb-1">Styled Description</label>
            <div id="styledDescriptionOutput"
                class="w-full p-2.5 bg-white/5 border border-white/10 rounded-lg text-sm min-h-[60px]"></div>
        </div>
    </div>
</div>
```

**Step 4: Commit**

```bash
git add client/index.html
git commit -m "feat: add voice pipeline UI elements (style selector, spectrogram, results)"
```

---

### Task 6: Client — Add element references

**Files:**
- Modify: `client/js/elements.js`

**Step 1: Add new element exports**

Append to `client/js/elements.js`:

```javascript
export const styleSelect = document.getElementById("styleSelect")
export const voicePipelineResults = document.getElementById("voicePipelineResults")
export const voicePipelineLoading = document.getElementById("voicePipelineLoading")
export const voicePipelineStatus = document.getElementById("voicePipelineStatus")
export const spectrogramContainer = document.getElementById("spectrogramContainer")
export const spectrogramOriginal = document.getElementById("spectrogramOriginal")
export const spectrogramDenoised = document.getElementById("spectrogramDenoised")
export const transcriptionOutput = document.getElementById("transcriptionOutput")
export const styledDescriptionContainer = document.getElementById("styledDescriptionContainer")
export const styledDescriptionOutput = document.getElementById("styledDescriptionOutput")
```

**Step 2: Commit**

```bash
git add client/js/elements.js
git commit -m "feat: add voice pipeline element references"
```

---

### Task 7: Client — Create voice-pipeline.js module

**Files:**
- Create: `client/js/voice-pipeline.js`

**Step 1: Write the voice pipeline module**

```javascript
import {
    styleSelect,
    voicePipelineResults,
    voicePipelineLoading,
    voicePipelineStatus,
    spectrogramContainer,
    spectrogramOriginal,
    spectrogramDenoised,
    transcriptionOutput,
    styledDescriptionContainer,
    styledDescriptionOutput,
} from "./elements.js"

import WaveSurfer from "https://cdn.jsdelivr.net/npm/wavesurfer.js@7/dist/wavesurfer.esm.js"
import Spectrogram from "https://cdn.jsdelivr.net/npm/wavesurfer.js@7/dist/plugins/spectrogram.esm.js"

let wsOriginal = null
let wsDenoised = null

export async function fetchStyles() {
    try {
        const res = await fetch("/api/styles")
        const styles = await res.json()
        styleSelect.innerHTML = '<option value="">-- No style --</option>'
        styles.forEach((s) => {
            const opt = document.createElement("option")
            opt.value = s.name
            opt.textContent = `${s.name} — ${s.description}`
            styleSelect.appendChild(opt)
        })
    } catch (err) {
        console.error("Failed to fetch styles:", err)
        styleSelect.innerHTML = '<option value="">Failed to load styles</option>'
    }
}

export async function processVoice(wavBlob) {
    const style = styleSelect.value

    // Show loading
    voicePipelineResults.classList.remove("hidden")
    voicePipelineLoading.classList.remove("hidden")
    spectrogramContainer.classList.add("hidden")
    voicePipelineStatus.textContent = "Sending to denoise service..."

    try {
        const formData = new FormData()
        formData.append("file", wavBlob, "recording.wav")
        if (style) {
            formData.append("style", style)
        }

        voicePipelineStatus.textContent = "Processing pipeline (denoise → STT → gen)..."

        const res = await fetch("/api/process-voice", {
            method: "POST",
            body: formData,
        })

        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.error || "Pipeline failed")
        }

        const result = await res.json()

        // Hide loading, show results
        voicePipelineLoading.classList.add("hidden")
        spectrogramContainer.classList.remove("hidden")

        // Render spectrograms
        renderSpectrograms(result.originalAudioUrl, result.denoisedAudioUrl)

        // Display transcription
        transcriptionOutput.textContent = result.transcription

        // Display styled description
        if (result.styledDescription) {
            styledDescriptionContainer.classList.remove("hidden")
            styledDescriptionOutput.textContent = result.styledDescription.generated_description
        } else {
            styledDescriptionContainer.classList.add("hidden")
        }
    } catch (err) {
        console.error("Voice pipeline error:", err)
        voicePipelineStatus.textContent = `Error: ${err.message}`
    }
}

function renderSpectrograms(originalUrl, denoisedUrl) {
    // Destroy previous instances
    if (wsOriginal) wsOriginal.destroy()
    if (wsDenoised) wsDenoised.destroy()

    // Clear containers
    spectrogramOriginal.innerHTML = ""
    spectrogramDenoised.innerHTML = ""

    const spectrogramOptions = {
        labels: true,
        height: 150,
        labelsColor: "#9ca3af",
        labelsBackground: "transparent",
        colorMap: "roseus",
    }

    wsOriginal = WaveSurfer.create({
        container: spectrogramOriginal,
        waveColor: "#6366f1",
        progressColor: "#4338ca",
        height: 60,
        url: originalUrl,
        plugins: [Spectrogram.create(spectrogramOptions)],
    })

    wsDenoised = WaveSurfer.create({
        container: spectrogramDenoised,
        waveColor: "#22c55e",
        progressColor: "#16a34a",
        height: 60,
        url: denoisedUrl,
        plugins: [Spectrogram.create(spectrogramOptions)],
    })

    // Click to play
    wsOriginal.on("interaction", () => wsOriginal.playPause())
    wsDenoised.on("interaction", () => wsDenoised.playPause())
}
```

**Step 2: Commit**

```bash
git add client/js/voice-pipeline.js
git commit -m "feat: add voice-pipeline.js client module (fetch styles, process voice, render spectrograms)"
```

---

### Task 8: Client — Integrate voice pipeline into recording flow

**Files:**
- Modify: `client/js/recording.js`
- Modify: `client/js/main.js`

**Step 1: Modify recording.js to call processVoice after stop**

Add import at the top of `recording.js`:

```javascript
import { processVoice } from "./voice-pipeline.js"
```

Modify the `stopRecording()` function — in the `videoRecorder.onstop` callback, after creating `audioBlob`, add the pipeline call. Replace the section that downloads audio:

Current code (lines 148-155):
```javascript
videoRecorder.onstop = () => {
    const videoBlob = new Blob(videoChunks, { type: "video/webm" })
    const audioBlob = createWavFile(recording.audioChunks)

    downloadFile(videoBlob, "recording.webm")
    downloadFile(audioBlob, "recording.wav")

    videoChunks = []
    recording.audioChunks = []
```

Replace with:
```javascript
videoRecorder.onstop = () => {
    const videoBlob = new Blob(videoChunks, { type: "video/webm" })
    const audioBlob = createWavFile(recording.audioChunks)

    downloadFile(videoBlob, "recording.webm")

    // Send audio through voice pipeline instead of downloading
    processVoice(audioBlob)

    videoChunks = []
    recording.audioChunks = []
```

**Step 2: Modify main.js to initialize voice pipeline**

Add import and init call in `client/js/main.js`:

```javascript
import { fetchStyles } from "./voice-pipeline.js"
```

Add at the end:
```javascript
fetchStyles()
```

**Step 3: Test end-to-end**

1. Start server with env vars set
2. Open browser to `http://localhost:3000`
3. Click "Start Audio" to begin listening
4. Click "Start Recording" to record
5. Click "Stop Recording" — should see loading state, then spectrograms + text results

**Step 4: Commit**

```bash
git add client/js/recording.js client/js/main.js
git commit -m "feat: integrate voice pipeline into recording stop flow"
```

---

### Task 9: Final — Test and verify complete pipeline

**Step 1: Start the server with all env vars**

```bash
DENOISE_SERVICE_BASE_URL=http://khoakomlem-internal.ddns.net:5000 \
VOICE_REPHRAZE_BASE_URL=http://your-voice-rephraze-host \
bun run index.js
```

**Step 2: Verify /api/styles works**

```bash
curl http://localhost:3000/api/styles
```
Expected: JSON array of styles

**Step 3: Test full pipeline in browser**

1. Open http://localhost:3000
2. Select a style from dropdown
3. Start Audio → Start Recording → speak → Stop Recording
4. Verify: loading spinner shows → spectrograms render side-by-side → transcription text appears → styled description appears
5. Click on spectrograms to play audio

**Step 4: Verify no regressions**

- Video recording still downloads as .webm
- Camera controls still work
- Audio visualizer still works

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "feat: complete voice processing pipeline integration"
```
