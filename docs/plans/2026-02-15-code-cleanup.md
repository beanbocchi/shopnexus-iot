# Code Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up the IoT codebase so ESP32 owns all defaults, remove dead code, fix module system, and eliminate unnecessary files/config.

**Architecture:** ESP32 is the single source of truth for camera settings. Client only displays settings received from ESP32 and relays user input. Server bridges TCP↔WebSocket.

**Tech Stack:** Node.js/Express (ESM), vanilla JS client, Arduino/ESP32-CAM (C++)

**Note:** No test framework exists in this project. Verification is manual: run `bun run index.js` and confirm the server starts without errors. ESP32 changes are verified by flashing and connecting.

---

### Task 1: Project file cleanup

**Files:**
- Delete: `stt/test.py`
- Modify: `jsconfig.json`
- Modify: `package.json`

**Step 1: Delete empty file**

```bash
rm stt/test.py
rmdir stt
```

**Step 2: Clean jsconfig.json**

Remove `"jsx": "react-jsx"` — no JSX exists in this project. Keep all other strict settings.

New `jsconfig.json`:
```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "allowJs": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false
  }
}
```

**Step 3: Clean package.json**

Remove `"peerDependencies"` block (no TypeScript files exist).

New `package.json`:
```json
{
  "name": "iot",
  "module": "index.js",
  "type": "module",
  "private": true,
  "devDependencies": {
    "@types/bun": "latest"
  },
  "dependencies": {
    "express": "^5.2.1",
    "ws": "^8.19.0"
  },
  "scripts": {
    "start": "bun run index.js"
  }
}
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove empty stt/test.py, clean jsconfig and package.json"
```

---

### Task 2: Server — Convert to ESM

**Files:**
- Modify: `index.js`

**Step 1: Replace require() with import**

Change the top of `index.js` from:
```js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const path = require('path');
```

To:
```js
import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

Note: ESM doesn't have `__dirname` built-in. We need `fileURLToPath` since `__dirname` is used on lines 167 and 170.

**Step 2: Verify server starts**

```bash
bun run index.js
```

Expected: Server starts, prints `TCP Camera listening on :3001`, `TCP Audio listening on :3002`, `Web Server running on http://0.0.0.0:3000`. Ctrl+C to stop.

**Step 3: Commit**

```bash
git add index.js
git commit -m "chore: convert server to ESM imports"
```

---

### Task 3: ESP32 — Add resetDefaults, remove dead code

**Files:**
- Modify: `esp32/esp32.ino`

**Step 1: Remove identical if/else branches in initCamera()**

Replace lines 114-124:
```cpp
if(psramFound()){
    camConfig.frame_size = FRAMESIZE_QVGA;
    camConfig.jpeg_quality = 20;
    camConfig.fb_count = 2;
    camConfig.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    camConfig.frame_size = FRAMESIZE_QVGA;
    camConfig.jpeg_quality = 20;
    camConfig.fb_count = 2;
    camConfig.grab_mode = CAMERA_GRAB_LATEST;
  }
```

With just:
```cpp
  camConfig.frame_size = FRAMESIZE_QVGA;
  camConfig.jpeg_quality = 20;
  camConfig.fb_count = 2;
  camConfig.grab_mode = CAMERA_GRAB_LATEST;
```

**Step 2: Add resetDefaults() function**

Add this function after `sendSettings()` (after line 90):

```cpp
void resetDefaults() {
  sensor_t * s = esp_camera_sensor_get();

  // Reset sensor settings to defaults
  s->set_quality(s, 20);
  s->set_framesize(s, FRAMESIZE_QVGA);
  s->set_brightness(s, 0);
  s->set_contrast(s, 0);
  s->set_saturation(s, 0);
  s->set_whitebal(s, 1);
  s->set_exposure_ctrl(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_aec2(s, 1);
  s->set_ae_level(s, 0);
  s->set_gainceiling(s, (gainceiling_t)0);
  s->set_bpc(s, 1);
  s->set_wpc(s, 1);
  s->set_raw_gma(s, 1);
  s->set_lenc(s, 1);
  s->set_hmirror(s, 0);
  s->set_vflip(s, 0);
  s->set_dcw(s, 1);
  s->set_colorbar(s, 0);

  // Reset XCLK to default (12MHz, index 2)
  if (currentXclkIdx != 2) {
    esp_camera_deinit();
    camConfig.xclk_freq_hz = xclkFreqs[2];
    currentXclkIdx = 2;
    camConfig.fb_count = 2;
    esp_camera_init(&camConfig);
  }

  sendSettings();
  Serial.println("Reset to defaults");
}
```

**Step 3: Add command 254 handler in loop()**

In the `switch(id)` block, add before `case 255`:

```cpp
          case 254: // Reset to defaults
            resetDefaults();
            break;
```

**Step 4: Commit**

```bash
git add esp32/esp32.ino
git commit -m "feat(esp32): add resetDefaults command, remove dead psram branch"
```

---

### Task 4: Client HTML — Remove redundant initial values

**Files:**
- Modify: `client/index.html`

**Step 1: Fix select text colors**

Line 90 — framesize select: change `text-red-500` to `text-[#e0e6f0]`
Line 146 — XCLK select: change `text-red` to `text-[#e0e6f0]`

**Step 2: Remove hardcoded values from debug controls**

These controls get populated by ESP32 via `applySettings()` on connect. Remove:

- XCLK select (data-id="20"): remove `selected` from option value="3"
- Frame Buffers select (data-id="21"): remove `selected` from option value="2"
- All debug range inputs (data-id 3,4,5,10,11): remove `value="0"` attributes
- All debug checkboxes (data-id 6-9, 12-19): remove `checked` attributes

Keep the quality slider and framesize select initial values — they're in the main controls section and serve as reasonable placeholder UI.

**Step 3: Commit**

```bash
git add client/index.html
git commit -m "fix(client): remove redundant initial values, fix select text colors"
```

---

### Task 5: Client JS — Remove dead code, simplify reset

**Files:**
- Modify: `client/js/controls.js`
- Modify: `client/js/camera.js`

**Step 1: Remove defaults object and simplify reset in controls.js**

Remove the entire `defaults` object (lines 10-32).

Replace the reset button handler (lines 99-124) with:

```js
document.getElementById("btnReset").onclick = () => {
    sendCmd(254, 0)
}
```

**Step 2: Fix empty catch block in camera.js**

Line 22 in `camera.js` — replace empty `catch (err) {}` with no try/catch at all since `JSON.parse` on a settings message that fails is harmless (we just ignore it):

Replace:
```js
        try {
            const msg = JSON.parse(e.data)
            if (msg.type === "settings") applySettings(msg.data)
        } catch (err) {}
```

With:
```js
        const msg = JSON.parse(e.data)
        if (msg.type === "settings") applySettings(msg.data)
```

Actually, keep the try/catch but log the error so issues are visible during development:

```js
        try {
            const msg = JSON.parse(e.data)
            if (msg.type === "settings") applySettings(msg.data)
        } catch (err) {
            console.warn("Failed to parse settings:", err)
        }
```

**Step 3: Verify server still starts**

```bash
bun run index.js
```

Expected: No errors.

**Step 4: Commit**

```bash
git add client/js/controls.js client/js/camera.js
git commit -m "refactor(client): remove defaults object, ESP32 owns reset logic"
```
