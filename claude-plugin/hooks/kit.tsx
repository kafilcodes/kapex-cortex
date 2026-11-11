import type { ElementTable, SvgProps } from 'claude-code'

import { icon, nodeSvg } from './icons'
import { K } from './theme'

// Styled pieces for the panel. Backgrounds are see-through over Claude Code's own canvas and text uses the app's theme
// colours, so it looks native in light and dark mode. Elevation by lightness: canvas → card → pill.
export type Kit = ReturnType<typeof kit>

export function kit(els: ElementTable, surface: string) {
  const { Box, Text } = els
  const Svg = surface === 'terminal' ? undefined : (els as unknown as { Svg?: (p: SvgProps) => JSX.Element }).Svg
  const size = (svg: string, d: 'width' | 'height') => Number(new RegExp(`${d}="(\\d+)"`).exec(svg)?.[1] ?? 0)
  return {
    Svg,
    /** a drawing, or its words where drawings can't show (the terminal) */
    graphic: (key: string, svg: string, alt: string, interactive = false) =>
      Svg ? <Svg key={key} source={svg} alt={alt} width={size(svg, 'width')} height={size(svg, 'height')} {...(interactive ? { isInteractive: true } : {})} /> : <Text key={key} color={K.label}>{alt}</Text>,
    /** a bento card: charcoal surface, hairline border, roomy padding. Its width is a starting share: it grows to fill
     * what its row leaves (padding and gaps never push it to a new line, and a card alone on its row spans it).
     * "100%" means "the whole width": no width at all, so it stretches inside its column and never overflows. */
    card: (key: string, width: string, children: (JSX.Element | null)[], accent?: string) => (
      <Box key={key} {...(width === '100%' ? {} : { width })} flexGrow={1} minWidth={24} flexDirection="column" gap={1} backgroundColor={K.card} borderStyle="round" borderColor={accent ?? K.hairline} paddingX={2} paddingY={1}>
        {children}
      </Box>
    ),
    /** card heading: small, quiet label with an optional right-hand value */
    head: (key: string, label: string, right?: string, rightColor?: string) => (
      <Box key={key} flexDirection="row" justifyContent="space-between" flexWrap="wrap" columnGap={1}>
        <Text size="caption" weight="medium" color={K.label}>{label}</Text>
        {right ? <Text size="caption" tabular color={rightColor ?? K.muted}>{right}</Text> : null}
      </Box>
    ),
    big: (key: string, value: string, color: string = K.text) => <Text key={key} size="title" weight="semibold" tabular color={color}>{value}</Text>,
    body: (key: string, text: string, color: string = K.text) => <Text key={key} color={color}>{text}</Text>,
    label: (key: string, text: string) => <Text key={key} size="caption" color={K.label}>{text}</Text>,
    muted: (key: string, text: string) => <Text key={key} size="caption" color={K.muted}>{text}</Text>,
    /** a coloured type chip, e.g. "Rule" in emerald */
    chip: (key: string, text: string, color: string) => <Text key={key} size="caption" weight="medium" color={color}>{text}</Text>,
    dot: (key: string, color: string) => <Text key={key} color={color}>●</Text>,
    /** a small icon followed by its words (falls back to the words alone in the terminal) */
    tag: (key: string, name: string, color: string, text: string, textColor: string = K.label) => (
      <Box key={key} flexDirection="row" gap={1} alignItems="center">
        {Svg ? <Svg key={`${key}-i`} source={icon(name, color, 13)} alt={`${name} icon`} width={13} height={13} /> : null}
        <Text size="caption" color={textColor}>{text}</Text>
      </Box>
    ),
    /** a timeline node: an icon in a soft disc (a plain dot in the terminal) */
    // alt is required: the desktop draws nothing for an Svg with an empty alt
    node: (key: string, name: string, color: string, size = 22) => Svg ? <Svg key={key} source={nodeSvg(name, color, size)} alt={`${name} icon`} width={size} height={size} /> : <Text key={key} color={color}>●</Text>,
    /** one line, cut with … unless expanded */
    line: (key: string, text: string, open: boolean, color: string = K.text, size?: 'caption') => <Text key={key} color={color} size={size} wrap={open ? 'wrap' : 'truncate-end'}>{text}</Text>,
    /** a small rounded tag */
    pill: (key: string, text: string, color: string = K.label) => <Box key={key} backgroundColor={K.pill} paddingX={1}><Text size="caption" color={color}>{text}</Text></Box>,
    /** an illustration beside its words (the words alone where drawings can't show) */
    illo: (key: string, svg: string, alt: string, kids: (JSX.Element | null)[], center = false) => (
      <Box key={key} flexDirection="row" gap={2} alignItems="center" justifyContent={center ? 'center' : 'flex-start'} flexWrap="wrap" paddingY={center ? 1 : 0}>
        {Svg ? <Svg key={`${key}-i`} source={svg} alt={alt} width={size(svg, 'width')} height={size(svg, 'height')} /> : null}
        <Box flexDirection="column" gap={1} flexGrow={center ? 0 : 1} flexShrink={1} minWidth={20}>{kids}</Box>
      </Box>
    ),
    /** a page's opening line: a title, one short caption and its drawing on the right; no card behind it */
    intro: (key: string, svg: string, alt: string, title: string, caption: string) => (
      <Box key={key} flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={2} flexWrap="wrap" paddingX={1}>
        <Box flexDirection="column" gap={0} flexGrow={1} flexShrink={1} minWidth={24}>
          <Text weight="semibold" color={K.text}>{title}</Text>
          <Text size="caption" color={K.label}>{caption}</Text>
        </Box>
        {Svg ? <Svg key={`${key}-i`} source={svg} alt={alt} width={size(svg, 'width')} height={size(svg, 'height')} /> : null}
      </Box>
    ),
    /** a section heading in Kapex Emerald */
    section: (key: string, text: string) => <Text key={key} weight="semibold" color={K.emerald}>{text}</Text>,
  }
}
