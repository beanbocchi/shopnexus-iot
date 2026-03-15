import { state } from "./state.js"
import { img, fpsEl, sizeEl } from "./elements.js"
import { sendCmd, applySettings } from "./controls.js"
import { drawFrameToCanvas } from "./recording.js"

let frameCount = 0
let lastTime = performance.now()

export function connectCam() {
	state.wsCam = new WebSocket("ws://" + location.host + "/camera")
	state.wsCam.binaryType = "arraybuffer"

	state.wsCam.onopen = () => {
		sendCmd(255, 0)
	}

	state.wsCam.onmessage = (e) => {
		// Text message = settings JSON
		if (typeof e.data === "string") {
			try {
				const msg = JSON.parse(e.data)
				if (msg.type === "settings") applySettings(msg.data)
			} catch (err) {
				console.warn("Failed to parse settings:", err)
			}
			return
		}

		// Binary message = JPEG frame
		const blob = new Blob([e.data], { type: "image/jpeg" })
		if (img.src) URL.revokeObjectURL(img.src)
		img.src = URL.createObjectURL(blob)
		img.onload = () => drawFrameToCanvas()

		// Stats
		frameCount++
		sizeEl.textContent = (e.data.byteLength / 1024).toFixed(1)

		const now = performance.now()
		if (now - lastTime >= 1000) {
			fpsEl.textContent = frameCount
			frameCount = 0
			lastTime = now
		}
	}

	state.wsCam.onclose = () => {
		setTimeout(connectCam, 2000)
	}
}
