import {
	styleSelect,
	resultsRow,
	noResultsHint,
	rephraseEmpty,
	rephraseStatus,
	voicePipelineLoading,
	voicePipelineStatus,
	spectrogramContainer,
	spectrogramOriginal,
	spectrogramDenoised,
	transcriptionOutput,
	styledDescriptionContainer,
	rephraseStyleBadge,
	rephraseOriginalOutput,
	styledDescriptionOutput,
	btnPlayOriginal,
	btnPlayDenoised,
	timeOriginal,
	timeDenoised,
	classifySection,
	classifyResults,
	classifyStatus,
	classifyEmpty,
} from "./elements.js"

import { classify, renderClassification } from "./classify.js"
import { formatTime, setVisible } from "./utils.js"

import WaveSurfer from "https://cdn.jsdelivr.net/npm/wavesurfer.js@7/dist/wavesurfer.esm.js"
import Spectrogram from "https://cdn.jsdelivr.net/npm/wavesurfer.js@7/dist/plugins/spectrogram.esm.js"

let wsOriginal = null
let wsDenoised = null

export async function fetchStyles() {
	try {
		const res = await fetch("/api/styles")
		const styles = await res.json()
		styleSelect.innerHTML = '<option value="">-- No style --</option>'
		for (const s of styles) {
			const value = typeof s === "string" ? s : (s.name || s.id || s.style || "unknown")
			const desc = typeof s === "object" && s.description ? ` — ${s.description}` : ""
			const opt = document.createElement("option")
			opt.value = value
			opt.textContent = `${value}${desc}`
			styleSelect.appendChild(opt)
		}
	} catch (err) {
		console.error("Failed to fetch styles:", err)
		styleSelect.innerHTML = '<option value="">Failed to load styles</option>'
	}
}

export async function processVoice(wavBlob) {
	const style = styleSelect.value

	// Show results row & loading state
	setVisible(noResultsHint, false)
	setVisible(resultsRow, true)
	setVisible(voicePipelineLoading, true)
	setVisible(spectrogramContainer, false)

	// Reset right panels
	setVisible(rephraseEmpty, true)
	setVisible(styledDescriptionContainer, false)
	setVisible(classifySection, false)
	setVisible(classifyEmpty, true)
	voicePipelineStatus.textContent = "Sending to denoise service..."

	try {
		const formData = new FormData()
		formData.append("file", wavBlob, "recording.wav")

		voicePipelineStatus.textContent = "Processing audio (denoise → STT)..."

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
		setVisible(voicePipelineLoading, false)
		setVisible(spectrogramContainer, true)

		// Render spectrograms
		renderSpectrograms(result.originalAudioUrl, result.denoisedAudioUrl)

		// Display transcription
		transcriptionOutput.textContent = result.transcription

		// Generate styled description (rephrase panel)
		if (result.transcription && style) {
			handleRephrase(result.transcription, style)
		} else if (result.transcription && !style) {
			// No style selected — show hint
			setVisible(rephraseEmpty, false)
			setVisible(styledDescriptionContainer, true)
			setVisible(rephraseStatus, false)
			rephraseOriginalOutput.textContent = result.transcription
			rephraseStyleBadge.textContent = "none"
			styledDescriptionOutput.innerHTML =
				'<span class="text-txt-muted text-xs">Select a style from the sidebar dropdown to generate a styled description.</span>'
		} else {
			setVisible(styledDescriptionContainer, false)
			if (!result.transcription) setVisible(rephraseEmpty, true)
		}

		// Classify transcription
		if (result.transcription) {
			handleClassify(result.transcription)
		}
	} catch (err) {
		console.error("Voice pipeline error:", err)
		voicePipelineStatus.textContent = `Error: ${err.message}`
	}
}

function handleRephrase(transcription, style) {
	setVisible(rephraseEmpty, false)
	setVisible(styledDescriptionContainer, true)
	setVisible(rephraseStatus, true)
	rephraseOriginalOutput.textContent = transcription
	rephraseStyleBadge.textContent = style
	styledDescriptionOutput.innerHTML = ""

	fetch("/api/gen-description", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ style, product_description: transcription }),
	})
		.then((res) => {
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return res.json()
		})
		.then((sd) => {
			setVisible(rephraseStatus, false)
			rephraseStyleBadge.textContent = sd.style || style
			rephraseOriginalOutput.textContent = sd.original_description || transcription

			if (sd.generated_description) {
				styledDescriptionOutput.textContent = sd.generated_description
			} else {
				styledDescriptionOutput.innerHTML =
					'<span class="text-accent-amber text-xs">Warning: Generation returned empty.</span>'
			}
		})
		.catch((err) => {
			setVisible(rephraseStatus, false)
			styledDescriptionOutput.innerHTML = `<p class="text-accent-red text-xs">Error: ${err.message}</p>`
		})
}

function handleClassify(transcription) {
	setVisible(classifyEmpty, false)
	setVisible(classifySection, true)
	classifyResults.innerHTML = ""
	setVisible(classifyStatus, true)

	classify(transcription, 10)
		.then((classifyData) => {
			setVisible(classifyStatus, false)
			renderClassification(classifyResults, classifyData)
		})
		.catch((err) => {
			setVisible(classifyStatus, false)
			classifyResults.innerHTML = `<p class="text-accent-red text-xs">Error: ${err.message}</p>`
		})
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
		timeEl.textContent = `0:00 / ${formatTime(ws.getDuration())}`
	})

	ws.on("timeupdate", (currentTime) => {
		timeEl.textContent = `${formatTime(currentTime)} / ${formatTime(ws.getDuration())}`
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
		labelsColor: "#8892a8",
		labelsBackground: "transparent",
		colorMap: "roseus",
	}

	wsOriginal = WaveSurfer.create({
		container: spectrogramOriginal,
		waveColor: "#8b5cf6",
		progressColor: "#6d3fcc",
		height: 60,
		url: originalUrl,
		plugins: [Spectrogram.create(spectrogramOptions)],
	})

	wsDenoised = WaveSurfer.create({
		container: spectrogramDenoised,
		waveColor: "#00ff88",
		progressColor: "#00b860",
		height: 60,
		url: denoisedUrl,
		plugins: [Spectrogram.create(spectrogramOptions)],
	})

	setupPlayer(wsOriginal, btnPlayOriginal, timeOriginal)
	setupPlayer(wsDenoised, btnPlayDenoised, timeDenoised)
}
