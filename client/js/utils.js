/**
 * utils.js — Shared utility functions
 */

/**
 * Format seconds into M:SS or MM:SS string.
 * @param {number} seconds
 * @param {boolean} [padMinutes=false] - Whether to zero-pad minutes
 * @returns {string}
 */
export function formatTime(seconds, padMinutes = false) {
	if (!isFinite(seconds)) return "0:00"
	const m = Math.floor(seconds / 60)
	const s = Math.floor(seconds % 60)
	const mins = padMinutes ? String(m).padStart(2, "0") : String(m)
	return `${mins}:${String(s).padStart(2, "0")}`
}

/**
 * Toggle visibility by adding/removing the 'hidden' class.
 * @param {HTMLElement} el
 * @param {boolean} visible
 */
export function setVisible(el, visible) {
	if (visible) {
		el.classList.remove("hidden")
	} else {
		el.classList.add("hidden")
	}
}
