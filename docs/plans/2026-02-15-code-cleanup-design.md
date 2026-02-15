# Code Cleanup Design — Principled Cleanup (Approach B)

## Principle

ESP32 is the source of truth for all camera settings and defaults. The client only displays and relays user input — it never defines defaults.

## Changes

### 1. ESP32 — Source of truth for defaults

- Add command ID `254` = "reset to defaults"
- `resetDefaults()` resets sensor to known-good values, calls `sendSettings()`
- Remove identical `if(psramFound())/else` branches — keep one block
- Client reset button sends `sendCmd(254, 0)`, ESP32 handles the rest

### 2. Server — Fix module system

- Convert `index.js` from CommonJS (`require()`) to ESM (`import`)
- `package.json` already declares `"type": "module"`

### 3. Client HTML — Remove redundant initial values

- Remove `value`, `selected`, `checked` from debug controls (ESP32 populates on connect)
- Fix `text-red-500` on framesize select and `text-red` on XCLK select to `text-[#e0e6f0]`

### 4. Client JS — Remove dead code

- `controls.js`: Remove `defaults` object, simplify reset to `sendCmd(254, 0)`
- `camera.js`: Remove empty `catch (err) {}`

### 5. Project cleanup

- Delete empty `stt/test.py`
- `jsconfig.json`: Remove `jsx` config (no JSX in project)
- `package.json`: Remove `"peerDependencies": { "typescript": "^5" }` (no TS files)
