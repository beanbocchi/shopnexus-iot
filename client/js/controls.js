import { state } from "./state.js"
import { qInput, qVal, fSelect, btnReset } from "./elements.js"

export function sendCmd(id, val) {
	if (state.wsCam && state.wsCam.readyState === WebSocket.OPEN) {
		state.wsCam.send(JSON.stringify({ id: parseInt(id), val: parseInt(val) }))
	}
}

/** Query all data-id range inputs (camera controls only) */
function getControlRanges() {
	return document.querySelectorAll("input[type=range][data-id]")
}

/** Query all data-id checkboxes (camera controls only) */
function getControlCheckboxes() {
	return document.querySelectorAll("input[type=checkbox][data-id]")
}

/** Query all debug selects */
function getControlSelects() {
	return document.querySelectorAll("select.debug-select[data-id]")
}

export function applySettings(s) {
	if (s[1] !== undefined) {
		qInput.value = s[1]
		qVal.textContent = s[1]
	}
	if (s[2] !== undefined) {
		fSelect.value = s[2]
	}

	for (const input of getControlRanges()) {
		const id = parseInt(input.dataset.id)
		if (s[id] !== undefined) {
			input.value = s[id]
			input.parentElement.querySelector("div:last-child").textContent = s[id]
		}
	}

	for (const input of getControlCheckboxes()) {
		const id = parseInt(input.dataset.id)
		if (s[id] !== undefined) {
			input.checked = !!s[id]
		}
	}

	for (const sel of getControlSelects()) {
		const id = parseInt(sel.dataset.id)
		if (s[id] !== undefined) {
			sel.value = s[id]
		}
	}
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

	for (const input of getControlRanges()) {
		input.oninput = (e) => {
			e.target.parentElement.querySelector("div:last-child").textContent = e.target.value
		}
		input.onchange = (e) => {
			sendCmd(e.target.dataset.id, e.target.value)
		}
	}

	for (const input of getControlCheckboxes()) {
		input.onchange = (e) => {
			sendCmd(e.target.dataset.id, e.target.checked ? 1 : 0)
		}
	}

	for (const sel of getControlSelects()) {
		sel.onchange = (e) => {
			sendCmd(e.target.dataset.id, e.target.value)
		}
	}

	btnReset.onclick = () => {
		sendCmd(254, 0)
	}
}
