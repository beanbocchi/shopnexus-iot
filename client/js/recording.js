import {
	img,
	recordCanvas,
	recordCtx,
	btnRecord,
	btnStopRecord,
	recIndicator,
	recTime,
	recDuration,
} from "./elements.js"
import { processVoice } from "./voice-pipeline.js"

export const recording = {
	isRecording: false,
	audioChunks: [],
}

let videoRecorder = null
let videoChunks = []
let recordStartTime = 0
let recordInterval = null

export function drawFrameToCanvas() {
	if (!recording.isRecording || !img.complete || !img.naturalWidth) return

	if (
		recordCanvas.width !== img.naturalWidth ||
		recordCanvas.height !== img.naturalHeight
	) {
		recordCanvas.width = img.naturalWidth
		recordCanvas.height = img.naturalHeight
	}

	recordCtx.drawImage(img, 0, 0)
}

function formatTime(seconds) {
	const mins = Math.floor(seconds / 60)
	const secs = seconds % 60
	return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

function writeString(view, offset, string) {
	for (let i = 0; i < string.length; i++) {
		view.setUint8(offset + i, string.charCodeAt(i))
	}
}

function createWavFile(chunks) {
	let totalLength = 0
	chunks.forEach((chunk) => {
		totalLength += chunk.byteLength
	})

	const sampleRate = 16000
	const numChannels = 1
	const bitsPerSample = 16

	const buffer = new ArrayBuffer(44 + totalLength)
	const view = new DataView(buffer)

	// RIFF header
	writeString(view, 0, "RIFF")
	view.setUint32(4, 36 + totalLength, true)
	writeString(view, 8, "WAVE")

	// fmt chunk
	writeString(view, 12, "fmt ")
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true)
	view.setUint16(22, numChannels, true)
	view.setUint32(24, sampleRate, true)
	view.setUint32(
		28,
		(sampleRate * numChannels * bitsPerSample) / 8,
		true,
	)
	view.setUint16(32, (numChannels * bitsPerSample) / 8, true)
	view.setUint16(34, bitsPerSample, true)

	// data chunk
	writeString(view, 36, "data")
	view.setUint32(40, totalLength, true)

	// Copy audio data
	let offset = 44
	chunks.forEach((chunk) => {
		const chunkView = new Int16Array(chunk)
		for (let i = 0; i < chunkView.length; i++) {
			view.setInt16(offset, chunkView[i], true)
			offset += 2
		}
	})

	return new Blob([buffer], { type: "audio/wav" })
}

function downloadFile(blob, filename) {
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	document.body.appendChild(a)
	a.click()
	document.body.removeChild(a)
	URL.revokeObjectURL(url)
}

function startRecording() {
	const canvasStream = recordCanvas.captureStream(30)

	videoChunks = []
	videoRecorder = new MediaRecorder(canvasStream, {
		mimeType: "video/webm;codecs=vp8",
		videoBitsPerSecond: 2500000,
	})

	videoRecorder.ondataavailable = (e) => {
		if (e.data.size > 0) {
			videoChunks.push(e.data)
		}
	}

	videoRecorder.start(100)

	recording.audioChunks = []
	recording.isRecording = true
	btnRecord.disabled = true
	btnStopRecord.disabled = false
	recIndicator.classList.remove("hidden")
	recTime.classList.remove("hidden")

	recordStartTime = Date.now()
	recordInterval = setInterval(() => {
		const elapsed = Math.floor((Date.now() - recordStartTime) / 1000)
		recDuration.textContent = formatTime(elapsed)
	}, 1000)
}

function stopRecording() {
	if (!recording.isRecording) return

	recording.isRecording = false
	clearInterval(recordInterval)

	videoRecorder.stop()

	videoRecorder.onstop = () => {
		const videoBlob = new Blob(videoChunks, { type: "video/webm" })
		const audioBlob = createWavFile(recording.audioChunks)

		downloadFile(videoBlob, "recording.webm")

		// Send audio through voice pipeline instead of downloading
		processVoice(audioBlob)

		videoChunks = []
		recording.audioChunks = []
		btnRecord.disabled = false
		btnStopRecord.disabled = true
		recIndicator.classList.add("hidden")
		recTime.classList.add("hidden")
		recDuration.textContent = "00:00"
	}
}

export function initRecording() {
	btnRecord.onclick = startRecording
	btnStopRecord.onclick = stopRecording
}
