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

function getIcon(categoryName) {
    return CATEGORY_ICONS[categoryName] || "🏷️"
}

/**
 * Classify a text string using top_k results.
 * @param {string} text
 * @param {number} [top_k=5]
 * @returns {Promise<{text:string, predictions: Array}>}
 */
export async function classify(text, top_k = 5) {
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
 * Render classification results into the given container element.
 * @param {HTMLElement} container
 * @param {{ predictions: Array }} result
 */
export function renderClassification(container, result) {
    container.innerHTML = ""

    if (!result?.predictions?.length) {
        container.innerHTML = `<p class="text-gray-400 text-sm">No predictions returned.</p>`
        return
    }

    // Top prediction badge
    const top = result.predictions[0]
    const topBadge = document.createElement("div")
    topBadge.className = "flex items-center gap-3 mb-3 p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30"
    topBadge.innerHTML = `
        <span class="text-2xl">${getIcon(top.category_name)}</span>
        <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-indigo-300">${top.display_name}</div>
            <div class="text-xs text-gray-400">#${top.category_id} · ${top.category_name}</div>
        </div>
        <div class="text-lg font-bold text-indigo-400">${(top.score * 100).toFixed(1)}%</div>
    `
    container.appendChild(topBadge)

    // Remaining predictions as mini-bars
    result.predictions.slice(1).forEach((pred, idx) => {
        const pct = (pred.score * 100).toFixed(2)
        const row = document.createElement("div")
        row.className = "flex items-center gap-2 mb-1.5"
        row.innerHTML = `
            <span class="text-base w-6 shrink-0">${getIcon(pred.category_name)}</span>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between text-[11px] mb-0.5">
                    <span class="text-gray-300 truncate">${pred.display_name}</span>
                    <span class="text-gray-400 font-mono ml-2 shrink-0">${pct}%</span>
                </div>
                <div class="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                    <div class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                         style="width: ${Math.max(pct, 0.5)}%"></div>
                </div>
            </div>
        `
        container.appendChild(row)
    })
}
