import type { ElementTable } from 'claude-code'

import { toggleExpanded, type Dollar } from './data'
import type { Kit } from './kit'
import { icon } from './icons'
import { K } from './theme'

// Structured pieces shared by every page: tinted badges, small metrics, a segmented control and the expandable tile
// (collapsed by default: icon, title, time, badges and a short preview; Expand shows the rest and its actions).
export type Tiles = ReturnType<typeof tiles>
const tint = (c: string, a = '24') => (/^#[0-9A-F]{6}$/i.test(c) ? `${c}${a}` : K.pill)
/** First `n` characters on a word boundary, with … when cut. */
export const preview = (t: string, n = 140) => (t.length <= n ? t : `${t.slice(0, n).replace(/\s+\S*$/, '')}…`)

export type TileSpec = {
  id: string
  icon: string
  color: string
  title: string
  time?: string
  /** [text, colour?, icon?]: an icon only where it helps recognise the kind at a glance */
  badges?: ([string, string?, string?] | null)[]
  preview?: string
  body?: (JSX.Element | null)[]
  actions?: (JSX.Element | null)[]
  /** actions that always show (e.g. Approve / Reject), next to the expand control */
  quick?: (JSX.Element | null)[]
  accent?: string
  /** the title is the content (a memory): show it wrapped, cut to a preview until expanded */
  wrap?: boolean
}

export function tiles($: Dollar, els: ElementTable, u: Kit, expanded: string[]) {
  const { Box, Text, Button } = els
  const badge = (key: string, text: string, color: string = K.label, ic?: string) => (
    <Box key={key} flexDirection="row" gap={1} alignItems="center" backgroundColor={tint(color)} paddingX={1}>
      {ic && u.Svg ? <u.Svg key={`${key}-i`} source={icon(ic, color === K.label ? K.silver : color, 11)} alt={`${ic} icon`} width={11} height={11} /> : null}
      <Text size="caption" weight="medium" color={color}>{text}</Text>
    </Box>
  )
  /** the L-shaped connector beside each tile in a list: a rail down the left, a curve into the tile; └ for the last */
  const rail = (key: string, last: boolean, ht: number) => {
    const line = `<path d="M7 0 V${last ? 18 : ht}" /><path d="M7 18 Q7 24 13 24 H18" />`
    return u.Svg ? <u.Svg key={key} source={`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="${ht}" viewBox="0 0 18 ${ht}" fill="none" stroke="${K.ink}" stroke-opacity="0.55" stroke-width="1.5" stroke-linecap="round">${line}</svg>`} alt="connector" width={18} height={ht} /> : null
  }
  /** the Timeline's list: tiles joined by a rail on the left (one day's events in order); `lines` estimates each tile's text lines so the rail
   * is at least as tall as its tile (a taller rail only adds space; a shorter one would leave a gap) */
  const railed = (key: string, items: { tile: JSX.Element; lines?: number }[]) => (
    <Box key={key} flexDirection="column" gap={0}>
      {items.map((it, i) => (
        <Box key={`${key}-r${i}`} flexDirection="row" gap={0} alignItems="flex-start">
          {rail(`${key}-rl${i}`, i === items.length - 1, 74 + 22 * Math.max(1, it.lines ?? 1))}
          <Box width="90%" flexGrow={1} flexShrink={1} minWidth={20} flexDirection="column" paddingBottom={1}>{it.tile}</Box>
        </Box>
      ))}
    </Box>
  )
  /** a flat list of tiles: no connectors, because nothing in it is a child of anything else */
  const stack = (key: string, items: JSX.Element[]) => <Box key={key} flexDirection="column" gap={1}>{items}</Box>
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
  /** sub-tabs: real buttons, the chosen one marked as primary, like the page tabs but smaller and quieter */
  const seg = (key: string, items: [string, string][], current: string, pick: (id: string) => void) => (
    <Box key={key} flexDirection="row" gap={1} flexWrap="wrap">
      {items.map(([id, label]) => (
        <Button key={`sub-${id}`} variant={id === current ? 'primary' : 'secondary'} onPress={() => pick(id)}>
          <Text size="caption" weight={id === current ? 'semibold' : 'medium'} color={id === current ? K.emerald : undefined}>{label}</Text>
        </Button>
      ))}
    </Box>
  )
  const tile = (t: TileSpec) => {
    const open = expanded.includes(t.id)
    const more = !!(t.body?.some(Boolean) || t.actions?.some(Boolean) || (t.preview && t.preview !== preview(t.preview)) || t.title.length > (t.wrap ? 140 : 70))
    return (
      <Box key={`tile-${t.id}`} flexDirection="column" gap={1} backgroundColor={K.card} borderStyle="round" borderColor={t.accent ?? K.hairline} paddingX={2} paddingY={1}>
        <Box flexDirection="row" gap={1} alignItems="flex-start">
          {u.node(`tn-${t.id}`, t.icon, t.color, 22)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={12} gap={0}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={1} alignItems="flex-start">
              <Box flexGrow={1} flexShrink={1} minWidth={8}>{t.wrap
                ? <Text weight="medium" color={K.text}>{open ? t.title : preview(t.title)}</Text>
                : <Text weight="medium" color={K.text} wrap={open ? 'wrap' : 'truncate-end'}>{t.title}</Text>}</Box>
              {t.time ? <Box flexShrink={0}><Text size="caption" color={K.muted} tabular wrap="truncate-end">{t.time}</Text></Box> : null}
            </Box>
            {t.preview ? <Text size="caption" color={K.label}>{open ? t.preview : preview(t.preview)}</Text> : null}
          </Box>
        </Box>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
          <Box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={1}>{(t.badges ?? []).filter((b): b is [string, string?, string?] => !!b).map(([text, color, ic], i) => badge(`tb-${t.id}-${i}`, text, color, ic))}</Box>
          <Box flexDirection="row" gap={1} alignItems="center" flexGrow={1} justifyContent="flex-end">
            {t.quick ?? null}
            {more ? <Button key={`tx-${t.id}`} plain onPress={() => { void toggleExpanded($, t.id) }}><Text size="caption" color={K.label}>{open ? 'Collapse' : 'Expand'}</Text></Button> : null}
          </Box>
        </Box>
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
  return { badge, metric, seg, tile, groupHead, railed, stack }
}
