/**
 * classify.js — Calls /api/classify and renders category predictions
 */

const CATEGORY_ICONS = {
	mobile_phones_tablets: "\u{1F4F1}",
	electronics: "\u{1F50C}",
	computers_networking: "\u{1F4BB}",
	fashion: "\u{1F457}",
	home_living: "\u{1F3E0}",
	health_beauty: "\u{1F484}",
	sports_outdoors: "\u{1F3C3}",
	food_beverages: "\u{1F354}",
	automotive: "\u{1F697}",
	books_media: "\u{1F4DA}",
}

const RANK_STYLES = [
	{
		bg: "bg-amber-500/15",
		border: "border-amber-500/30",
		text: "text-amber-300",
		bar: "bg-gradient-to-r from-amber-400 to-yellow-500",
		badge: "bg-amber-500 text-black",
	},
	{
		bg: "bg-slate-400/10",
		border: "border-slate-400/20",
		text: "text-slate-300",
		bar: "bg-gradient-to-r from-slate-400 to-slate-500",
		badge: "bg-slate-400 text-black",
	},
	{
		bg: "bg-orange-700/10",
		border: "border-orange-600/20",
		text: "text-orange-300",
		bar: "bg-gradient-to-r from-orange-500 to-amber-700",
		badge: "bg-orange-600 text-white",
	},
]

const DEFAULT_STYLE = {
	bg: "bg-white/[0.03]",
	border: "border-white/[0.06]",
	text: "text-txt-secondary",
	bar: "bg-gradient-to-r from-accent-violet to-purple-700",
	badge: "bg-white/15 text-txt-secondary",
}

function getIcon(categoryName) {
	return CATEGORY_ICONS[categoryName] || "\u{1F3F7}"
}

/**
 * Classify a text string.
 * @param {string} text
 * @param {number} [top_k=10]
 * @returns {Promise<{text: string, predictions: Array}>}
 */
export async function classify(text, top_k = 10) {
	const res = await fetch("/api/classify", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text, top_k }),
	})

	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }))
		throw new Error(err.error || "Classification failed")
	}

	return res.json()
}

/**
 * Render top-10 classification results as a ranked leaderboard.
 * @param {HTMLElement} container
 * @param {{ predictions: Array }} result
 */
export function renderClassification(container, result) {
	container.innerHTML = ""

	if (!result?.predictions?.length) {
		container.innerHTML = '<p class="text-txt-muted text-xs">No predictions returned.</p>'
		return
	}

	const topScore = result.predictions[0].score || 1

	for (const [idx, pred] of result.predictions.entries()) {
		const rank = idx + 1
		const pct = pred.score * 100
		const relW = Math.max((pred.score / topScore) * 100, 2).toFixed(1)
		const style = RANK_STYLES[idx] ?? DEFAULT_STYLE
		const fmtPct = pct >= 0.01 ? pct.toFixed(2) : pct.toExponential(1)

		const row = document.createElement("div")
		row.className = `classify-row flex items-center gap-2 rounded-md px-2.5 py-1.5 border ${style.bg} ${style.border} mb-1`
		row.innerHTML = `
			<span class="font-display text-[0.5625rem] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${style.badge}">${rank}</span>
			<span class="text-sm shrink-0">${getIcon(pred.category_name)}</span>
			<div class="flex-1 min-w-0">
				<div class="flex justify-between items-baseline mb-0.5">
					<span class="font-display text-[0.6875rem] font-medium ${style.text} truncate">${pred.display_name}</span>
					<span class="font-display text-[0.625rem] text-txt-muted ml-1.5 shrink-0">${fmtPct}%</span>
				</div>
				<div class="w-full bg-white/[0.05] rounded-full h-[3px] overflow-hidden">
					<div class="h-full rounded-full ${style.bar} transition-all duration-700 ease-out" style="width:${relW}%"></div>
				</div>
			</div>
		`
		container.appendChild(row)
	}
}
