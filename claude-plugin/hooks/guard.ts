// The panel's safety net. The desktop app drops a pane whose drawing is too big or whose hook throws, and the pane then
// stays blank ("has not drawn this pane") until the app restarts. So every page is drawn inside `safely` (a page that
// throws becomes a short card with a way back, never a blank pane), and every finished drawing passes `withinBudget`,
// which keeps it under the sizes the app handles well by dropping the least important drawings first.

/** What one pane drawing may hold. Measured 2026-11-17: a Timeline page is ~150 KB with ~60 drawings; 160 events at once
 * (~750 KB, 336 drawings) made the desktop app drop the pane. These leave room for the busiest page with a wide margin. */
export const BUDGET = { svgChars: 260_000, svgs: 140 }
/** The engine refuses a whole pane whose tree holds one Svg source this long. */
const SVG_HARD = 131_072

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown } & Record<string, unknown>
const isNode = (n: unknown): n is Node => !!n && typeof n === 'object' && !Array.isArray(n)

/** Counts what a drawing holds: elements, drawings and their characters. */
export function measure(tree: unknown): { nodes: number; svgs: number; svgChars: number; biggest: number } {
  const out = { nodes: 0, svgs: 0, svgChars: 0, biggest: 0 }
  const walk = (n: unknown, d: number): void => {
    if (d > 40 || n === null || n === undefined || typeof n !== 'object') return
    if (Array.isArray(n)) { for (const c of n) walk(c, d); return }
    out.nodes++
    const p = (n as Node).props ?? {}
    if ((n as Node).type === 'Svg' && typeof p.source === 'string') { out.svgs++; out.svgChars += p.source.length; out.biggest = Math.max(out.biggest, p.source.length) }
    walk((n as Node).children ?? p.children, d + 1)
  }
  walk(tree, 0)
  return out
}

/** The drawing as it is when within budget; otherwise a copy where drawings past the budget (the last ones on the page,
 * which sit furthest down) become their words, as the terminal shows them (small ones a blank spacer, given `blank`). Never throws: on anything odd it returns
 * the tree unchanged. */
export function withinBudget(tree: unknown, words: (key: string, alt: string) => unknown, budget = BUDGET, blank?: (key: string, cols: number) => unknown): unknown {
  try {
    const m = measure(tree)
    if (m.svgs <= budget.svgs && m.svgChars <= budget.svgChars && m.biggest < SVG_HARD) return tree
    let svgs = 0, chars = 0
    const map = (n: unknown, d: number): unknown => {
      if (d > 40 || n === null || n === undefined || typeof n !== 'object') return n
      if (Array.isArray(n)) return n.map(c => map(c, d))
      const node = n as Node, p = node.props ?? {}
      if (node.type === 'Svg' && typeof p.source === 'string') {
        if (p.source.length < SVG_HARD && svgs + 1 <= budget.svgs && chars + p.source.length <= budget.svgChars) { svgs++; chars += p.source.length; return n }
        const key = String(p.key ?? `w${svgs}-${chars}`)
        // a small drawing past the budget (an icon, a rail piece) is decoration: an empty spacer of its width keeps the
        // row's indent, and no "check icon" words show; a chart or illustration becomes its words
        if (blank && typeof p.height === 'number' && p.height <= 2) return blank(key, 1) // a divider line
        if (blank && typeof p.width === 'number' && p.width <= 48) return blank(key, Math.max(1, Math.ceil(p.width / 7.2)))
        return typeof p.alt === 'string' && p.alt ? words(key, p.alt) : null
      }
      const kids = node.children ?? p.children
      if (kids === undefined) return n
      const next = map(kids, d + 1)
      return 'children' in node ? { ...node, children: next } : { ...node, props: { ...p, children: next } }
    }
    return map(tree, 0)
  } catch { return tree }
}

/** Runs a page builder; if it throws, the reason (for the card and the error log) instead of a broken pane. */
export function safely<T>(build: () => T): { ok: true; tree: T } | { ok: false; why: string } {
  try { return { ok: true, tree: build() } } catch (err) { return { ok: false, why: String((err as Error)?.message ?? err).replace(/\s+/g, ' ').slice(0, 200) || 'unknown error' } }
}
