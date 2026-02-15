import { state } from "./state.js"
import { qInput, qVal, fSelect } from "./elements.js"

export function sendCmd(id, val) {
	if (state.wsCam && state.wsCam.readyState === WebSocket.OPEN) {
		state.wsCam.send(JSON.stringify({ id: parseInt(id), val: parseInt(val) }))
	}
}

const defaults = {
	1: 20,
	2: 5, // quality, framesize (QVGA)
	3: 0,
	4: 0,
	5: 0, // brightness, contrast, saturation
	6: 1,
	7: 1,
	8: 1,
	9: 1, // AWB, AEC, AGC, AEC2
	10: 0,
	11: 0, // ae_level, gainceiling
	12: 1,
	13: 1,
	14: 1,
	15: 1, // BPC, WPC, raw_gma, lenc
	16: 0,
	17: 0,
	18: 1,
	19: 0, // hmirror, vflip, dcw, colorbar
	20: 2, // xclk (index 2 = 12MHz)
	21: 2, // fb_count
}

export function applySettings(s) {
	if (s[1] !== undefined) {
		qInput.value = s[1]
		qVal.textContent = s[1]
	}
	if (s[2] !== undefined) {
		fSelect.value = s[2]
	}
	document.querySelectorAll(".grid input[type=range]").forEach((input) => {
		const id = parseInt(input.dataset.id)
		if (s[id] !== undefined) {
			input.value = s[id]
			input.parentElement.querySelector("div:last-child").textContent =
				s[id]
		}
	})
	document
		.querySelectorAll(".grid input[type=checkbox]")
		.forEach((input) => {
			const id = parseInt(input.dataset.id)
			if (s[id] !== undefined) {
				input.checked = !!s[id]
			}
		})
	document.querySelectorAll(".grid select.debug-select").forEach((sel) => {
		const id = parseInt(sel.dataset.id)
		if (s[id] !== undefined) {
			sel.value = s[id]
		}
	})
}

export function initControls() {
	qInput.oninput = (e) => {
		qVal.textContent = e.target.value
	}
	qInput.onchange = (e) => {
		sendCmd(1, e.target.value)
	}
	fSelect.onchange = (e) => {
		sendCmd(2, e.target.value)
	}

	document.querySelectorAll(".grid input[type=range]").forEach((input) => {
		input.oninput = (e) => {
			e.target.parentElement.querySelector("div:last-child").textContent =
				e.target.value
		}
		input.onchange = (e) => {
			sendCmd(e.target.dataset.id, e.target.value)
		}
	})
	document
		.querySelectorAll(".grid input[type=checkbox]")
		.forEach((input) => {
			input.onchange = (e) => {
				sendCmd(e.target.dataset.id, e.target.checked ? 1 : 0)
			}
		})
	document.querySelectorAll(".grid select.debug-select").forEach((sel) => {
		sel.onchange = (e) => {
			sendCmd(e.target.dataset.id, e.target.value)
		}
	})

	document.getElementById("btnReset").onclick = () => {
		for (const [id, val] of Object.entries(defaults)) {
			sendCmd(id, val)
		}
		qInput.value = 20
		qVal.textContent = "20"
		fSelect.value = "5"
		document
			.querySelectorAll(".grid input[type=range]")
			.forEach((input) => {
				const def = defaults[input.dataset.id] || 0
				input.value = def
				input.parentElement.querySelector("div:last-child").textContent =
					def
			})
		document
			.querySelectorAll(".grid input[type=checkbox]")
			.forEach((input) => {
				input.checked = !!defaults[input.dataset.id]
			})
		document
			.querySelectorAll(".grid select.debug-select")
			.forEach((sel) => {
				sel.value = defaults[sel.dataset.id] || 0
			})
	}
}
