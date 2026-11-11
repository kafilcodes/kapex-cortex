import type { ElementTable, InputProps, SelectProps } from 'claude-code'
import { sceneSvg } from './mascot'

import type { StatusView } from '../types'
import { act, type Dollar } from './data'
import type { Kit } from './kit'
import { K } from './theme'

// Settings as three cards (Dream · Handoff · You), two columns when the pane is wide. Each setting shows a one-line
// summary; the full explanation appears on hover (desktop) or below it (terminal). Saved with `kc prefs set …`.
const MODES: [string, string][] = [['lean', 'Lean'], ['balanced', 'Balanced'], ['rich', 'Rich']]
const ONOFF: [string, string][] = [['on', 'On'], ['off', 'Off']]
const MODE_HELP: Record<string, string> = {
  lean: 'Smallest: the last exchange only, about 2,000 tokens to start a new chat.',
  balanced: 'The last three exchanges in full: about 2,000 to 7,500 tokens to start a new chat.',
  rich: 'More room for long plans and replies: up to about 12,000 tokens to start a new chat.',
}
const BACKENDS: [string, string][] = [['claude', 'Claude, on your plan (recommended)'], ['opencode', 'An OpenCode model (free models cost nothing)'], ['api', 'Your own API key'], ['off', 'No model: Cortex\'s own checks only']]
const BACKEND_HELP: Record<string, [string, string]> = {
  claude: ['A Claude model judges what the checks can\'t: what is out of date, repeated, or only needed for some files.', 'Runs claude -p in the background with no tools, no plugins and no settings, on your Claude plan: about 10k to 25k tokens per Dream. It only reads your memory files and the evidence Cortex extracted (test runs, your words, commits), and every claim it makes must point at that evidence.'],
  opencode: ['A model from your OpenCode setup judges in the background.', 'OpenCode\'s free models cost nothing; your memory files and the extracted evidence go to that model\'s provider.'],
  api: ['A model on your own API key judges (you pay the provider).', 'The key is read from CORTEX_CLASSIFIER_KEY or your macOS keychain (pbpaste | kc key), never from a file. Your memory files and the extracted evidence go to that provider.'],
  off: ['Only what a program can verify: lines over the limit, broken links, files and colours that are gone, claims that test runs contradict, duplicates.', 'No tokens at all. A Dream finds less without a model, but everything it finds is certain.'],
}

export function settingsBody($: Dollar, els: ElementTable, u: Kit, s: StatusView, wide = false): JSX.Element {
  const { Box, Text, Button } = els
  const Select = (els as unknown as { Select?: (p: SelectProps) => JSX.Element }).Select
  const Input = (els as unknown as { Input?: (p: InputProps) => JSX.Element }).Input
  const desktop = !!u.Svg
  const pr = s.prefs
  if (!pr) return <Text key="st-old" color={K.label}>Settings need a newer Cortex. Press Refresh.</Text>
  const save = (key: string, value: string) => { void act($, 'Saved', ['prefs', 'set', key, value]) }
  // the summary always shows; the full text on hover (desktop), or always (terminal, which has no hover)
  const help = (key: string, short: string, full = '', warn = false) => (
    <Box key={`h-${key}`} flexDirection="column">
      <Text size="caption" color={warn ? K.amber : K.label}>{short}</Text>
      {full ? (desktop
        ? <Box display="none" hover={{ scope: `hs-${key}`, display: 'flex' }}><Text size="caption" color={K.muted}>{full}</Text></Box>
        : <Text size="caption" color={K.muted}>{full}</Text>) : null}
    </Box>
  )
  const field = (key: string, label: string, options: [string, string][], value: string, short: string, full = '', warn = false) => (
    <Box key={`st-${key}`} flexDirection="column" gap={0} paddingY={1} hover={{ scope: `hs-${key}` }}>
      {Select
        ? <Select key={`sel-${key}`} label={label} value={value} options={options.map(([v, l]) => ({ value: v, label: l }))} onSelect={v => save(key, v)} />
        : <Box flexDirection="row" gap={1} flexWrap="wrap"><Text color={K.text}>{label}</Text>{options.map(([v, l]) => <Button key={`opt-${key}-${v}`} variant={v === value ? 'primary' : 'secondary'} onPress={() => save(key, v)}>{l}</Button>)}</Box>}
      {help(key, short, full, warn)}
    </Box>
  )
  const text = (key: string, label: string, value: string, placeholder: string) => Input
    ? <Input key={`in-${key}`} label={label} value={value} placeholder={placeholder} submitLabel="Save" onSubmit={v => save(key, v.trim())} />
    : <Text key={`in-${key}`} size="caption" color={K.label}>{`${label}: ${value || 'not set'} (set with: kc prefs set ${key} <value>)`}</Text>
  const w = wide ? '45%' : '90%' // a row: '90%' is alone on its line, grown to fill it
  const sec = (key: string, icon: string, title: string, sub: string, children: (JSX.Element | null)[]) => u.card(key, w, [
    <Box key={`${key}-h`} flexDirection="row" gap={1} alignItems="center">
      {u.node(`${key}-n`, icon, K.emerald, 22)}
      <Box flexDirection="column"><Text weight="semibold" color={K.text}>{title}</Text><Text size="caption" color={K.muted}>{sub}</Text></Box>
    </Box>,
    ...children,
  ])
  const be = pr.dreamBackend ?? 'claude'
  const [short, full] = BACKEND_HELP[be] ?? BACKEND_HELP.claude!
  return (
    <Box flexDirection="column" gap={1}>
    {u.intro('st-in', sceneSvg('settings', 120), 'Cortex adjusting its preferences', 'Preferences', 'Every change saves at once.')}
    <Box key="st" flexDirection="row" flexWrap="wrap" gap={1}>
      {sec('sec-dream', 'dream', 'Dream', 'Checks your memory files against what really happened', [
        field('dreamBackend', 'Who judges', BACKENDS, be, short, full),
        be === 'claude' ? field('dreamModel', 'Model', [['sonnet', 'Sonnet (recommended)'], ['haiku', 'Haiku: faster, finds less'], ['opus', 'Opus: most careful, uses most']], pr.dreamModel || 'sonnet', 'Sonnet balances care and cost; the checks Cortex runs itself are the same with every model.') : null,
        be === 'opencode' ? text('dreamModel', 'OpenCode model (provider/model)', pr.dreamModel ?? '', 'opencode/deepseek-v4.1-flash-free') : null,
        be === 'api' ? field('dreamApi', 'Provider', [['anthropic', 'Anthropic'], ['openai', 'OpenAI-compatible (OpenRouter, Groq, …)']], pr.dreamApi ?? 'anthropic', 'Where the key is from.') : null,
        be === 'api' ? text('dreamModel', 'Model name', pr.dreamModel ?? '', 'e.g. claude-sonnet-5-5') : null,
        be === 'api' && pr.dreamApi === 'openai' ? text('dreamUrl', 'Endpoint', pr.dreamUrl ?? '', 'https://openrouter.ai/api/v1') : null,
        field('dreamTranscripts', 'Chats to read', [['5', 'The last 5'], ['10', 'The last 10'], ['20', 'The last 20']], String(pr.dreamTranscripts ?? 10), 'More chats find more, and cost a little more with a model.'),
        field('quickCheck', 'Quick check after every turn', ONOFF, pr.quickCheck === false ? 'off' : 'on', pr.quickCheck === false ? 'Off: Quick check runs only when you press it.' : 'On: checks your memory in the background when files change. Free.', 'It looks for lines over the limit, broken links, files and colours that are gone, and duplicates, then shows what it found here with Apply / Keep buttons. The Stop hook only compares file times, so turns stay fast.'),
        field('autoDream', 'Dream by itself', ONOFF, pr.autoDream ? 'on' : 'off', pr.autoDream ? 'After a session ends, at most once a day, after 3 new chats. It only proposes: you still Apply.' : 'Off: Dreams run only when you press Dream now.', 'An automatic Dream never changes a file. It saves its findings, and the strip shows how many wait for you.'),
      ])}
      {sec('sec-hand', 'link', 'Handoff', 'What a new chat reads with /cortex-resume', [
        field('tokenMode', 'Handoff size', MODES, pr.tokenMode, MODE_HELP[pr.tokenMode] ?? ''),
        field('handoffAt', 'Offer a fresh chat at', [['70', '70% full'], ['80', '80% full (recommended)'], ['90', '90% full']], String(pr.handoffAt ?? 80), `Asks at ${pr.handoffAt ?? 80}% (${(pr.handoffAt ?? 80) - 10}% with a cold cache). You confirm.`, 'Yes saves the handoff and copies /cortex-resume for you to paste in a new chat. Later waits 30 minutes or 5 more points.'),
        field('autoPark', 'Turn off unused MCP servers (disable)', ONOFF, pr.autoPark === false ? 'off' : 'on', pr.autoPark === false ? 'Off: turn them off yourself in Costs.' : 'On: unused in your last 10+ chats here → off in new chats. Turn on again anytime.', 'Uses Claude Code\'s own per-project switch (the one /mcp writes). Never the Claude app\'s own servers. Each parked server stops loading its tool names and instructions into every message.'),
        ...((s.parked?.servers ?? []).length ? [<Box key="st-pk" flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          <Text size="caption" color={K.label}>{`Off here: ${s.parked!.servers.map(x => x.name).join(', ')}`}</Text>
          <Button key="st-unpark" variant="secondary" onPress={() => { void act($, 'Back on', ['park', 'remove', ...s.parked!.servers.map(x => x.name)]) }}>Turn all back on</Button>
        </Box>] : []),
        <Text key="st-cost" size="caption" color={K.label}>{`The current handoff is about ${(pr.tokens?.handoff ?? 0).toLocaleString()} tokens, saved after every reply.`}</Text>,
      ])}
      {sec('sec-you', 'star', 'You', 'Greeting and name', [
        field('greeting', 'Greeting', ONOFF, pr.greeting === false ? 'off' : 'on', pr.greeting === false ? 'Off: the panel shows the project name.' : `On: ${s.name ? `"${(h => (h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'))(new Date().getHours())}, ${s.name}"` : 'no name found yet; set one below'}.`, 'The name comes from your setting below, else your computer account\'s full name (first word). It stays on this computer, in ~/.cortex, never in your project.'),
        text('name', 'Your name (optional)', pr.name ?? '', s.name || 'e.g. Kafil'),
        <Text key="st-scope" size="caption" color={K.muted}>{pr.overridden.length ? `Saved for you on this computer. This project overrides: ${pr.overridden.join(', ')}.` : 'Saved for you on this computer, used in every project.'}</Text>,
      ])}
    </Box>
    </Box>
  )
}
