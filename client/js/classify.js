/**
 * classify.js – calls /api/classify and renders category predictions
 */

const CATEGORY_ICONS = {
    mobile_phones_tablets: "📱",
    electronics: "🔌",
    computers_networking: "💻",
    fashion: "👗",
    home_living: "🏠",
    health_beauty: "💄",
    sports_outdoors: "🏃",
    food_beverages: "🍔",
    automotive: "🚗",
    books_media: "📚",
}

const RANK_COLORS = [
    { bg: "bg-amber-500/20",    border: "border-amber-500/40",   text: "text-amber-300",  bar: "from-amber-400 to-yellow-500",  badge: "bg-amber-500 text-black" },
    { bg: "bg-slate-400/10",    border: "border-slate-400/25",   text: "text-slate-300",  bar: "from-slate-400 to-slate-500",   badge: "bg-slate-400 text-black" },
    { bg: "bg-orange-700/10",   border: "border-orange-600/25",  text: "text-orange-300", bar: "from-orange-500 to-amber-700",  badge: "bg-orange-600 text-white" },
]
const DEFAULT_COLOR = {
    bg: "bg-white/[0.03]", border: "border-white/[0.06]",
    text: "text-gray-300",  bar: "from-indigo-600 to-purple-700",
    badge: "bg-white/20 text-gray-300",
}

function getIcon(categoryName) {
    return CATEGORY_ICONS[categoryName] || "🏷️"
}

/**
 * Classify a text string.
 * @param {string} text
 * @param {number} [top_k=10]
 * @returns {Promise<{text:string, predictions: Array}>}
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
 * Bar widths are relative to the #1 score for maximum visual clarity.
 * @param {HTMLElement} container
 * @param {{ predictions: Array }} result
 */
export function renderClassification(container, result) {
    container.innerHTML = ""

    if (!result?.predictions?.length) {
        container.innerHTML = `<p class="text-gray-400 text-xs">No predictions returned.</p>`
        return
    }

    const topScore = result.predictions[0].score || 1

    result.predictions.forEach((pred, idx) => {
        const rank  = idx + 1
        const pct   = pred.score * 100
        // bar width relative to top score so differences are always visible
        const relW  = Math.max((pred.score / topScore) * 100, 2).toFixed(1)
        const color = RANK_COLORS[idx] ?? DEFAULT_COLOR

        const fmtPct = pct >= 0.01 ? pct.toFixed(2) : pct.toExponential(1)

        const row = document.createElement("div")
        row.className = `flex items-center gap-2 rounded-lg px-2 py-1.5 border ${color.bg} ${color.border} mb-1`
        row.innerHTML = `
            <span class="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${color.badge}">${rank}</span>
            <span class="text-sm shrink-0">${getIcon(pred.category_name)}</span>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-baseline mb-0.5">
                    <span class="text-[11px] font-medium ${color.text} truncate">${pred.display_name}</span>
                    <span class="text-[10px] font-mono text-gray-400 ml-1.5 shrink-0">${fmtPct}%</span>
                </div>
                <div class="w-full bg-white/[0.07] rounded-full h-1 overflow-hidden">
                    <div class="h-full rounded-full bg-gradient-to-r ${color.bar} transition-all duration-700 ease-out"
                         style="width:${relW}%"></div>
                </div>
            </div>
        `
        container.appendChild(row)
    })
}
