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
			const value = typeof s === "string" ? s : (s.name || s.id || s.style || "unknown")
			const desc = typeof s === "object" && s.description ? ` — ${s.description}` : ""
			
			const opt = document.createElement("option")
			opt.value = value
			opt.textContent = `${value}${desc}`
			styleSelect.appendChild(opt)
		})
	} catch (err) {
		console.error("Failed to fetch styles:", err)
		styleSelect.innerHTML = '<option value="">Failed to load styles</option>'
	}
}

export async function processVoice(wavBlob) {
	const style = styleSelect.value

	// Show results row & loading state
	noResultsHint.classList.add("hidden")
	resultsRow.classList.remove("hidden")
	voicePipelineLoading.classList.remove("hidden")
	spectrogramContainer.classList.add("hidden")
	// Reset right panels
	rephraseEmpty.classList.remove("hidden")
	styledDescriptionContainer.classList.add("hidden")
	classifySection.classList.add("hidden")
	classifyEmpty.classList.remove("hidden")
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
		voicePipelineLoading.classList.add("hidden")
		spectrogramContainer.classList.remove("hidden")

		// Render spectrograms
		renderSpectrograms(result.originalAudioUrl, result.denoisedAudioUrl)

		// Display transcription
		transcriptionOutput.textContent = result.transcription

		// Generate styled description (rephrase panel)
		if (result.transcription && style) {
			rephraseEmpty.classList.add("hidden")
			styledDescriptionContainer.classList.remove("hidden")
			
			// Show spinner, clear old data
			rephraseStatus.classList.remove("hidden")
			rephraseOriginalOutput.textContent = result.transcription
			rephraseStyleBadge.textContent = style
			styledDescriptionOutput.innerHTML = ""

			// Fire-and-forget subtask
			fetch("/api/gen-description", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ style, product_description: result.transcription })
			})
				.then((res) => {
					if (!res.ok) throw new Error(`HTTP ${res.status}`)
					return res.json()
				})
				.then((sd) => {
					rephraseStatus.classList.add("hidden")
					rephraseStyleBadge.textContent = sd.style || style
					rephraseOriginalOutput.textContent = sd.original_description || result.transcription
					
					if (sd.generated_description) {
						styledDescriptionOutput.textContent = sd.generated_description
					} else {
						styledDescriptionOutput.innerHTML =
							'<span class="text-amber-400 text-xs">⚠️ Generation returned empty.</span>'
					}
				})
				.catch((err) => {
					rephraseStatus.classList.add("hidden")
					styledDescriptionOutput.innerHTML = `<p class="text-red-400 text-xs">Error: ${err.message}</p>`
				})
		} else {
			styledDescriptionContainer.classList.add("hidden")
			if (!result.transcription) rephraseEmpty.classList.remove("hidden")
		}

		// Classify transcription
		if (result.transcription) {
			classifyEmpty.classList.add("hidden")
			classifySection.classList.remove("hidden")
			classifyResults.innerHTML = ""
			classifyStatus.classList.remove("hidden")
			
			// Fire-and-forget subtask
			classify(result.transcription, 10)
				.then((classifyData) => {
					classifyStatus.classList.add("hidden")
					renderClassification(classifyResults, classifyData)
				})
				.catch((err) => {
					classifyStatus.classList.add("hidden")
					classifyResults.innerHTML = `<p class="text-red-400 text-xs">Error: ${err.message}</p>`
				})
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
