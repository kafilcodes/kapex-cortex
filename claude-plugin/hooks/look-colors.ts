import type { ThemeColors } from 'claude-code'

import { makeColors } from './vendor/make-colors.js'

// The Kapex look's colours (Settings → Look): Obsidian in dark mode (true black with an emerald cast, made for OLED
// screens) and Mist in light mode (cool paper with pine-green accents). Surfaces step up in lightness a few percent
// apart; colour carries meaning only. (A Graphite dark ground was tried in v4.1 and dropped: it looked muddy under
// the app's frosted panels.)
// make-colors.js (vendor/, the design system's own builder) turns these anchors into the app's ~100 colour names.

export type Ground = 'obsidian' | 'amoled'

const ROLES = { accent: '#10B981', danger: '#F43F5E', success: '#22C55E', warning: '#F59E0B', pro: '#14B8A6' }

const DARK: Record<Ground, Record<string, string>> = {
  obsidian: { 'surface-0': '#040605', 'surface-1': '#0A0F0D', 'surface-2': '#101714', 'surface-3': '#151E1A', 'text-primary': '#E8F1EC', 'text-secondary': '#B4C3BB', 'text-muted': '#8E9D96' },
  // AMOLED black: the chat, the side panes (Cortex's panel among them) and the strip on pure black, so they are one
  // ground and an OLED screen turns those pixels off; raised surfaces keep a faint emerald step so cards still read
  amoled: { 'surface-0': '#000000', 'surface-1': '#000000', 'surface-2': '#000000', 'surface-3': '#18201C', 'text-primary': '#E8F1EC', 'text-secondary': '#B4C3BB', 'text-muted': '#8E9D96' },
}
const MIST = { 'surface-0': '#EDF2EF', 'surface-1': '#F4F8F6', 'surface-2': '#FBFDFC', 'surface-3': '#FBFDFC', 'text-primary': '#0B1912', 'text-secondary': '#33473D', 'text-muted': '#52645A' }

const made = new Map<Ground, { theme: ThemeColors; problems: string[] }>()
/** The whole palette for a dark ground (Mist in light mode), built once per ground. */
export function lookColors(ground: Ground): { theme: ThemeColors; problems: string[] } {
  let m = made.get(ground)
  if (!m) {
    m = makeColors({
      label: ground === 'amoled' ? 'Kapex AMOLED' : 'Kapex Obsidian', id: `kapex-${ground}`, roles: ROLES,
      light: { gray: { anchors: MIST as never }, roles: { accent: '#047857', warning: '#B45309', danger: '#BE123C', success: '#15803D', pro: '#0F766E' } },
      dark: { gray: { anchors: DARK[ground] as never }, git: { added: '#22C55E', removed: '#F43F5E', modified: '#F59E0B' } },
    })
    made.set(ground, m)
  }
  return m
}
