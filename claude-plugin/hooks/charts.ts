// Small formatting helpers for the panel (numbers, model names, cache clock). The charts are in viz.ts.

export const k = (n: number) => (n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 2)}B` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

/** "claude-opus-5-5[1m]" → "Opus 5.5"; other ids are shown as given. */
export function prettyModel(id: string): string {
  const m = /claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i.exec(id)
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : id
}

/** Cache warmth from the last reply's time and the cache lifetime. */
export function cacheState(lastAt: number | null, ttlMs: number, now = Date.now()): { state: 'warm' | 'cooling' | 'cold' | 'unknown'; leftMin: number; until: number | null } {
  if (!lastAt) return { state: 'unknown', leftMin: 0, until: null }
  const until = lastAt + ttlMs
  const left = Math.round((until - now) / 60_000)
  return { state: left <= 0 ? 'cold' : left <= Math.max(1, ttlMs / 60_000 / 6) ? 'cooling' : 'warm', leftMin: Math.max(0, left), until }
}

export const clock = (ms: number) => {
  const d = new Date(ms)
  const h = d.getHours()
  return `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
