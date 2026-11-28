import type { ElementTable } from 'claude-code'

import { toggleExpanded, type Dollar } from './data'
import type { Kit } from './kit'
import { icon } from './icons'
import { lead as leadSvg, type Lead } from './leads'
import { HEAT, K } from './theme'

// Structured pieces shared by every page: tinted badges, small metrics, a segmented control and the expandable tile
// (collapsed by default: icon, title, time, badges and a short preview; Expand shows the rest and its actions).
export type Tiles = ReturnType<typeof tiles>
const tint = (c: string, a = '24') => (/^#[0-9A-F]{6}$/i.test(c) ? `${c}${a}` : K.pill)
/** A badge's words: mid-tone status hexes wash out on a light ground (amber on Mist is under 2:1), so the words take
 * the theme's own success / warning / error keys (AA on Obsidian and Mist); the tint behind them keeps the hex. */
export const ink = (c: string): string => (c === K.amber || c === HEAT.warn || c === HEAT.high ? 'warning' : c === K.rose ? 'error' : c === K.emerald || c === K.sage ? 'success' : c === K.silver ? K.label : c)
/** First `n` characters on a word boundary, with … when cut. */
export const preview = (t: string, n = 140) => (t.length <= n ? t : `${t.slice(0, n).replace(/\s+\S*$/, '').replace(/[\s.…,;:]+$/, '')}…`) // one ellipsis, never "……"

export type TileSpec = {
  id: string
  /** the icon disc: the fallback where the drawing (`lead`) is not given */
  icon: string
  color: string
  /** the drawing that leads the tile and says its kind at a glance; `alt` is a real phrase ("A reply whose checks passed") */
  lead?: { kind: Lead; alt: string; tint?: string; muted?: boolean }
  title: string
  time?: string
  /** [text, colour?, icon?]: an icon only where it helps recognise the kind at a glance */
  badges?: ([string, string?, string?] | null)[]
  preview?: string
  body?: (JSX.Element | null)[]
  actions?: (JSX.Element | null)[]
  /** actions that always show (e.g. Approve / Reject), next to the expand control */
  quick?: (JSX.Element | null)[]
  /** one line above the badges and actions: what Cortex suggests, read before choosing */
  suggest?: JSX.Element | null
  accent?: string
  /** the title is the content (a memory): show it wrapped, cut to a preview until expanded */
  wrap?: boolean
  /** one line of a list (Memory files): the expand control sits on the title's row and no badge row is drawn */
  compact?: boolean
  /** a row inside `rows` (one shared card): no surface or edge of its own */
  flat?: boolean
}

export function tiles($: Dollar, els: ElementTable, u: Kit, expanded: string[], px = 800) {
  const { Box, Text, Button } = els
  const leadPx = px < 520 ? 32 : 40 // narrow panes keep the drawing, smaller, so titles keep their room
  const badge = (key: string, text: string, color: string = K.label, ic?: string) => (
    <Box key={key} flexDirection="row" gap={1} alignItems="center" backgroundColor={tint(color)} paddingX={1}>
      {ic && u.Svg ? <u.Svg key={`${key}-i`} source={icon(ic, color === K.label ? K.silver : color, 11)} alt={`${ic} icon`} width={11} height={11} /> : null}
      <Text size="caption" weight="medium" color={ink(color)}>{text}</Text>
    </Box>
  )
  /** The L-shaped connector beside one tile. Its Box is one row tall and centred on the tile by the layout (the row
   * is `alignItems="center"`); the drawing overflows it equally up and down, so the elbow lands on the tile's middle
   * whatever the tile's real height. `up` / `down` are how far the rail reaches toward the neighbours (0 = none). */
  const rail = (key: string, up: number, down: number, color: string) => {
    const half = Math.max(up, down, 14), tall = half * 2, c = half
    const v = up && down ? `<path d="M7 ${c - up} V${c + down}"/><path d="M7 ${c - 6} Q7 ${c} 13 ${c} H18"/>`
      : up ? `<path d="M7 ${c - up} V${c - 6} Q7 ${c} 13 ${c} H18"/>`
      : down ? `<path d="M7 ${c + down} V${c + 6} Q7 ${c} 13 ${c} H18"/>`
      : `<path d="M7 ${c} H18"/>`
    return u.Svg ? <u.Svg key={key} source={`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="${tall}" viewBox="0 0 18 ${tall}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round">${v}</svg>`} alt="connector" width={18} height={tall} /> : null
  }
  /** the Timeline's list: one day's tiles joined by a rail on the left. `lines` estimates each tile's text lines; each
   * half of the rail reaches about 0.8 of the estimated distance to the neighbour's middle, so the two halves that
   * meet between two tiles overlap and neither runs past a neighbour's elbow. `color`: emerald for today. */
  const railed = (key: string, items: { tile: JSX.Element; lines?: number }[], color: string = K.ink) => {
    const hts = items.map(it => 60 + 22 * Math.max(1, it.lines ?? 1)) // estimated tile height in px
    const reach = (i: number) => Math.round(0.8 * (hts[i]! / 2 + 8 + hts[i + 1]! / 2)) // to the next tile's middle (8 px gap)
    return (
      <Box key={key} flexDirection="column" gap={1}>
        {items.map((it, i) => (
          <Box key={`${key}-r${i}`} flexDirection="row" gap={0} alignItems="center">
            <Box key={`${key}-rb${i}`} height={1} flexShrink={0} overflow="visible" flexDirection="column" justifyContent="center">{rail(`${key}-rl${i}`, i > 0 ? reach(i - 1) : 0, i < items.length - 1 ? reach(i) : 0, color)}</Box>
            <Box width="90%" flexGrow={1} flexShrink={1} minWidth={20} flexDirection="column">{it.tile}</Box>
          </Box>
        ))}
      </Box>
    )
  }
  /** Rows inside an open tile, joined by a mini rail: a thin spine on the left with an elbow into each row, like the
   * Timeline's rail at a smaller scale, so a tile's own items read as one connected list. `lines` estimates each row's
   * text lines (caption size); the halves reach about 0.8 of the way to the next row's middle and overlap there. */
  // `from`: px the first row's line reaches up, out of the body to the tile's badge row (the body is inset 4 columns,
  // so the spine sits under the first badge): the wire then starts at that badge, e.g. Memory's "Applied"
  const twig = (key: string, rows: { el: JSX.Element; lines?: number }[], color: string = K.ink, from = 0) => {
    if (rows.length < 2 && !from) return <Box key={key} flexDirection="column" gap={1}>{rows.map(r => r.el)}</Box>
    // each elbow sits on its row's first line (one text row, where the icon is; Box sizes are text rows), so two elbows are one row plus the gap apart; each
    // half reaches 0.6 of that and they overlap, with room to spare if a row wraps to fewer lines than estimated
    const hts = rows.map(r => 4 + 17 * Math.max(1, r.lines ?? 1))
    const reach = (i: number) => Math.round(0.6 * (hts[i]! + 8))
    return (
      <Box key={key} flexDirection="column" gap={1}>
        {rows.map((r, i) => (
          <Box key={`${key}-r${i}`} flexDirection="row" gap={0} alignItems="flex-start">
            <Box key={`${key}-rb${i}`} height={1} flexShrink={0} overflow="visible" flexDirection="column" justifyContent="center">{rail(`${key}-rl${i}`, i > 0 ? reach(i - 1) : from, i < rows.length - 1 ? reach(i) : 0, color)}</Box>
            <Box width="90%" flexGrow={1} flexShrink={1} minWidth={20} flexDirection="column">{r.el}</Box>
          </Box>
        ))}
      </Box>
    )
  }
  /** a flat list of tiles: no connectors, because nothing in it is a child of anything else */
  const stack = (key: string, items: JSX.Element[]) => <Box key={key} flexDirection="column" gap={1}>{items}</Box>
  /** a list as rows on one card (craft: lists are made of rows, not a card per row): tiles drawn `flat`, a hairline
   * between them (a 1 px drawing clipped to the card's width; plain space where drawings can't show) */
  const rows = (key: string, items: JSX.Element[]) => (
    <Box key={key} flexDirection="column" backgroundColor={K.card} borderStyle="round" borderColor={K.cardEdge} paddingX={2}>
      {items.flatMap((it, i) => i === 0 ? [it] : [u.Svg ? <Box key={`${key}-d${i}`} overflow="hidden" flexDirection="row"><u.Svg key={`${key}-ds${i}`} source={`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1"><rect width="2400" height="1" fill="${K.hairline}"/></svg>`} alt="divider" width={2400} height={1} /></Box> : null, it])}
    </Box>
  )
  /** an icon, a value and what it counts, side by side */
  const metric = (key: string, icon: string, color: string, value: string, label: string, width = '30%') => (
    <Box key={key} {...(width === '100%' ? {} : { width })} flexGrow={1} minWidth={14} flexDirection="row" gap={1} alignItems="center" backgroundColor={K.pill} {...u.inset()} paddingX={1} paddingY={1}>
      {u.node(`${key}-n`, icon, color, 20)}
      <Box flexDirection="column" flexShrink={1} minWidth={6}>
        <Text weight="semibold" tabular color={color === K.silver ? K.text : color}>{value}</Text>
        <Text size="caption" color={K.muted}>{label}</Text>
      </Box>
    </Box>
  )
  /** An open tile's numbers as one light row of figures, like a spec sheet: a small icon and the value over a quiet
   * label, thin rules between them where the row has room. No boxes or fills: the tile is already the container.
   * A zero reads muted, so the figures that matter stand out. */
  const RULE = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="30" viewBox="0 0 1 30"><rect width="1" height="30" fill="rgba(127,127,127,0.28)"/></svg>'
  const stats = (key: string, items: { icon: string; value: string; label: string; color?: string }[]) => {
    const Svg = u.Svg, rules = px >= 640 && !!Svg
    return (
      <Box key={key} flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={rules ? 2 : 3} rowGap={1}>
        {items.flatMap((it, i) => {
          const quiet = /^(0|none|–)$/.test(it.value), c = it.color ?? K.silver
          return [
            i && rules && Svg ? <Box key={`${key}-r${i}`} flexShrink={0}><Svg key={`${key}-rs${i}`} source={RULE} alt="divider" width={1} height={30} /></Box> : null,
            <Box key={`${key}-${i}`} flexDirection="column" gap={0} flexShrink={0}>
              <Box flexDirection="row" gap={1} alignItems="center">
                {u.Svg ? <u.Svg key={`${key}-i${i}`} source={icon(it.icon, quiet ? K.silver : c, 12)} alt={`${it.icon} icon`} width={12} height={12} /> : null}
                <Text weight="semibold" tabular color={quiet ? K.muted : c === K.silver ? K.text : c}>{it.value}</Text>
              </Box>
              <Text size="caption" color={K.muted}>{it.label}</Text>
            </Box>,
          ]
        })}
      </Box>
    )
  }
  /** sub-tabs: quieter than the page tabs, so they read as views of one page: one borderless track, each option
   * small text in its own cell, the chosen cell tinted emerald (like Settings' option control) */
  const seg = (key: string, items: [string, string][], current: string, pick: (id: string) => void) => (
    <Box key={key} flexDirection="row"><Box flexDirection="row" alignItems="center" backgroundColor={K.pill} flexWrap="wrap">
      {items.map(([id, label]) => (
        <Box key={`segb-${id}`} paddingX={1} alignItems="center" {...(id === current ? { backgroundColor: `${K.emerald}38` } : {})}>
          <Button key={`sub-${id}`} plain onPress={() => { if (id !== current) pick(id) }}>
            <Text size="caption" weight={id === current ? 'semibold' : 'medium'} color={id === current ? K.text : K.label}>{label}</Text>
          </Button>
        </Box>
      ))}
    </Box></Box>
  )
  const tile = (t: TileSpec) => {
    const open = expanded.includes(t.id)
    const more = !!(t.body?.some(Boolean) || t.actions?.some(Boolean) || (t.preview && t.preview !== preview(t.preview)) || t.title.length > (t.wrap ? 140 : 70))
    const toggle = more ? <Button key={`tx-${t.id}`} plain onPress={() => { void toggleExpanded($, t.id) }}><Text size="caption" color={K.label}>{open ? 'Show less' : 'Show more'}</Text></Button> : null
    const badges = (t.badges ?? []).filter((b): b is [string, string?, string?] => !!b)
    const inline = !!t.compact && !badges.length && !t.quick?.some(Boolean)
    return (
      <Box key={`tile-${t.id}`} flexDirection="column" gap={1} {...(t.flat ? {} : { backgroundColor: K.card, borderStyle: 'round', borderColor: t.accent ?? K.cardEdge, paddingX: 2 })} paddingY={1}>
        <Box flexDirection="row" gap={1} alignItems={t.lead && u.Svg && !open ? 'center' : 'flex-start'}>
          {t.lead && u.Svg
            ? <Box key={`tl-${t.id}`} flexShrink={0}><u.Svg key={`tn-${t.id}`} source={leadSvg(t.lead.kind, leadPx, t.lead.tint, t.lead.muted)} alt={t.lead.alt} width={leadPx} height={leadPx} /></Box>
            : u.node(`tn-${t.id}`, t.icon, t.color, 22)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={12} gap={0}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={1} alignItems="flex-start">
              <Box flexGrow={1} flexShrink={1} minWidth={8}>{t.wrap
                ? <Text weight="medium" color={K.text}>{open ? t.title : preview(t.title)}</Text>
                : <Text weight="medium" color={K.text} wrap={open ? 'wrap' : 'truncate-end'}>{t.title}</Text>}</Box>
              {t.time ? <Box flexShrink={0}><Text size="caption" color={K.muted} tabular wrap="truncate-end">{t.time}</Text></Box> : null}
              {inline && toggle ? <Box key={`txb-${t.id}`} flexShrink={0}>{toggle}</Box> : null}
            </Box>
            {t.preview ? <Text size="caption" color={K.label}>{open ? t.preview : preview(t.preview)}</Text> : null}
          </Box>
        </Box>
        {t.suggest ?? null}
        {inline ? null : <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
          <Box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={1}>{badges.map(([text, color, ic], i) => badge(`tb-${t.id}-${i}`, text, color, ic))}</Box>
          <Box flexDirection="row" gap={1} alignItems="center" flexGrow={1} justifyContent="flex-end" flexWrap="wrap">
            {t.quick ?? null}
            {toggle}
          </Box>
        </Box>}
        {open && t.body?.some(Boolean) ? <Box key={`tbody-${t.id}`} flexDirection="column" gap={1} paddingLeft={4}>{t.body}</Box> : null}
        {open && t.actions?.some(Boolean) ? <Box key={`tact-${t.id}`} flexDirection="row" gap={1} flexWrap="wrap" paddingLeft={4}>{t.actions}</Box> : null}
      </Box>
    )
  }
  /** a group heading: icon, title, a count badge and an optional control on the right */
  const groupHead = (key: string, icon: string, color: string, title: string, count: string | null, right?: JSX.Element | null) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} paddingTop={1}>
      <Box flexDirection="row" gap={1} alignItems="center">
        {u.node(`${key}-n`, icon, color, 18)}
        <Text weight="semibold" color={K.text}>{title}</Text>
        {count ? badge(`${key}-c`, count, color) : null}
      </Box>
      {right ?? null}
    </Box>
  )
  return { badge, metric, stats, seg, tile, groupHead, railed, twig, stack, rows }
}
