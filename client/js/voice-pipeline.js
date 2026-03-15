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
	btnPlayOriginal,
	btnPlayDenoised,
	timeOriginal,
	timeDenoised,
	classifySection,
	classifyResults,
	classifyStatus,
} from "./elements.js"

import { classify, renderClassification } from "./classify.js"

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

		// Classify transcription
		if (result.transcription) {
			classifySection.classList.remove("hidden")
			classifyResults.innerHTML = ""
			classifyStatus.classList.remove("hidden")
			try {
				const classifyData = await classify(result.transcription, 5)
				classifyStatus.classList.add("hidden")
				renderClassification(classifyResults, classifyData)
			} catch (err) {
				classifyStatus.textContent = `Classification error: ${err.message}`
			}
		}
	} catch (err) {
		console.error("Voice pipeline error:", err)
		voicePipelineStatus.textContent = `Error: ${err.message}`
	}
}

function formatAudioTime(seconds) {
	if (!isFinite(seconds)) return "0:00"
	const m = Math.floor(seconds / 60)
	const s = Math.floor(seconds % 60)
	return `${m}:${String(s).padStart(2, "0")}`
}

function setupPlayer(ws, btn, timeEl) {
	const playIcon = "&#9654;"
	const pauseIcon = "&#9646;&#9646;"

	function updateBtn(playing) {
		btn.querySelector(".play-icon").innerHTML = playing ? pauseIcon : playIcon
	}

	btn.onclick = () => ws.playPause()
	ws.on("interaction", () => ws.playPause())

	ws.on("play", () => updateBtn(true))
	ws.on("pause", () => updateBtn(false))
	ws.on("finish", () => updateBtn(false))

	ws.on("ready", () => {
		const dur = ws.getDuration()
		timeEl.textContent = `0:00 / ${formatAudioTime(dur)}`
	})

	ws.on("timeupdate", (currentTime) => {
		const dur = ws.getDuration()
		timeEl.textContent = `${formatAudioTime(currentTime)} / ${formatAudioTime(dur)}`
	})
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

	setupPlayer(wsOriginal, btnPlayOriginal, timeOriginal)
	setupPlayer(wsDenoised, btnPlayDenoised, timeDenoised)
}
