import { state } from "./state.js"
import { btnAudio, viz } from "./elements.js"
import { recording } from "./recording.js"

const bars = []

export function initVisualizer() {
	for (let i = 0; i < 30; i++) {
		const b = document.createElement("div")
		b.className = "w-1 bg-indigo-500 rounded-sm min-h-[2px] bar"
		viz.appendChild(b)
		bars.push(b)
	}
}

function playChunk(buf) {
	const int16 = new Int16Array(buf)
	const float32 = new Float32Array(int16.length)
	let max = 0

	for (let i = 0; i < int16.length; i++) {
		float32[i] = int16[i] / 32768.0
		if (Math.abs(float32[i]) > max) max = Math.abs(float32[i])
	}

	// Viz
	bars.forEach((b) => (b.style.height = max * 100 * Math.random() + "px"))

	const audioBuf = state.audioCtx.createBuffer(1, float32.length, 16000)
	audioBuf.getChannelData(0).set(float32)

	const src = state.audioCtx.createBufferSource()
	src.buffer = audioBuf
	src.connect(state.audioCtx.destination)

	const now = state.audioCtx.currentTime
	if (state.nextTime < now) state.nextTime = now + 0.3
	src.start(state.nextTime)
	state.nextTime += audioBuf.duration
}

export function connectAudio() {
	const wsAudio = new WebSocket("ws://" + location.host + "/audio")
	wsAudio.binaryType = "arraybuffer"

	wsAudio.onmessage = (e) => {
		if (recording.isRecording) {
			recording.audioChunks.push(e.data.slice(0))
		}
		if (!state.audioCtx) return
		playChunk(e.data)
	}
}

export function initAudioButton() {
	btnAudio.onclick = async () => {
		state.audioCtx = new (window.AudioContext ||
			window.webkitAudioContext)({
			sampleRate: 16000,
		})
		await state.audioCtx.resume()
		btnAudio.disabled = true
		btnAudio.textContent = "Listening..."
	}
}
