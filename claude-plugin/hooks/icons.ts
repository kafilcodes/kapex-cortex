// Small line icons for the panel (24-unit grid, 2-unit strokes, round caps). Hand-drawn here so Cortex keeps zero
// dependencies; each is one SVG at any size and colour. Used for header status, memory types and turn outcomes.
const P: Record<string, string> = {
  branch: '<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="7" r="2.2"/><path d="M6 7.2v9.6M18 9.2c0 5-12 3.8-12 7.6"/>',
  model: '<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z"/>',
  sync: '<path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18z"/><path d="M9.5 14l2 2 3.5-3.5"/>',
  link: '<path d="M10 14l4-4M8.5 11.5l-2 2a3 3 0 0 0 4.2 4.2l2-2M15.5 12.5l2-2a3 3 0 0 0-4.2-4.2l-2 2"/>',
  rule: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  fact: '<path d="M5 5a2 2 0 0 1 2-2h11v15H7a2 2 0 0 0-2 2z"/><path d="M5 20a2 2 0 0 1 2-2h11v3H7a2 2 0 0 1-2-1z"/>',
  decision: '<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>',
  preference: '<path d="M4 7h9M17 7h3M4 17h4M12 17h8"/><circle cx="15" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  lesson: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 3.8 10.6c-.6.5-.8 1.2-.8 2V16H9v-.4c0-.8-.3-1.5-.8-2A6 6 0 0 1 12 3z"/>',
  failed: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  promoted: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 14h6M10 17h4"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  commit: '<circle cx="12" cy="12" r="3.2"/><path d="M3 12h5.8M15.2 12H21"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  test: '<path d="M9 3h6M10 3v6l-5 10a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5-10V3"/>',
  spark: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5L9 15M15 9l2.5-2.5"/>',
  turn: '<path d="M4 6h16M4 12h10M4 18h7"/>',
  merge: '<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 7.2v9.6M6 7.2c0 4 4 4.8 9.8 4.8"/>',
  compaction: '<path d="M4 4h16v5H4zM4 15h16v5H4z"/><path d="M12 9v6M9.5 12.5L12 15l2.5-2.5"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 3.8 10.6c-.6.5-.8 1.2-.8 2V16H9v-.4c0-.8-.3-1.5-.8-2A6 6 0 0 1 12 3z"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 14h8v7H8z"/>',
  dream: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/><path d="M16 3.5v3M14.5 5h3"/>',
  move: '<path d="M4 12h13M13 7l5 5-5 5"/><path d="M20 4v16"/>',
}

export type IconName = keyof typeof P

/** One icon as a complete SVG document. */
export function icon(name: IconName | string, color: string, size = 14): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? P.spark}</svg>`
}

/** The icon's inner shapes, for drawing inside a bigger SVG (place it with a transform). */
export const iconPaths = (name: IconName | string) => P[name] ?? P.spark!

/** Health as a small ring: a full emerald ring with a check, or an amber arc with a mark when something needs you. */
export function healthRing(ok: boolean, size = 18): string {
  const c = ok ? '#10B981' : '#F59E0B'
  const arc = ok ? '<circle cx="12" cy="12" r="9" stroke-width="2.4"/>' : '<path d="M12 3a9 9 0 1 1-8.5 6" stroke-width="2.4"/>'
  const mark = ok ? '<path d="M8 12.3l2.8 2.8L16.2 9.6" stroke-width="2.2"/>' : '<path d="M12 8v4.5M12 15.8v.4" stroke-width="2.4"/>'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-linecap="round" stroke-linejoin="round">${arc}${mark}</svg>`
}

/** A timeline node: the event's icon in a soft disc of its colour (replaces plain dots). */
export function nodeSvg(name: string, color: string, size = 22): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-opacity="0.55"/><g transform="translate(5.5 5.5) scale(0.54)" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? P.spark}</g></svg>`
}
