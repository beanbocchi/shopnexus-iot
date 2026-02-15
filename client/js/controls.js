import { state } from "./state.js"
import { qInput, qVal, fSelect } from "./elements.js"

export function sendCmd(id, val) {
	if (state.wsCam && state.wsCam.readyState === WebSocket.OPEN) {
		state.wsCam.send(JSON.stringify({ id: parseInt(id), val: parseInt(val) }))
	}
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
		sendCmd(254, 0)
	}
}
