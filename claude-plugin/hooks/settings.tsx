import type { ElementTable, InputProps, SelectProps } from 'claude-code'
import { miniSvg, sceneSvg, type Mini } from './mascot'

import type { StatusView } from '../types'
import { act, type Dollar } from './data'
import { replayIntro } from './intro'
import type { Kit } from './kit'
import { K } from './theme'
import { toolName } from './tips'
import { companion } from './blocky'

// Settings as four cards (Handoff · Dream · Safety · You; Safety first while it has something to fix), two columns
// when the pane is wide. Each setting is a label, a one-line summary and its options side by side: one press, saved
// with `kc prefs set …`. The full explanation appears on hover (desktop) or below it (terminal).
const MODES: [string, string][] = [['lean', 'Less'], ['balanced', 'Balanced'], ['rich', 'More']]
const ONOFF: [string, string][] = [['on', 'On'], ['off', 'Off']]
const MODE_HELP: Record<string, string> = {
  lean: 'Only the last exchange: a new chat starts at about 2,000 tokens.',
  balanced: 'The last three exchanges in full: a new chat starts at 2,000 to 7,500 tokens.',
  rich: 'Extra room for long plans and replies: a new chat starts at up to 12,000 tokens.',
}
const BACKENDS: [string, string][] = [['claude', 'Claude, on your plan (recommended)'], ['opencode', 'An OpenCode model (free models cost nothing)'], ['api', 'Your own API key'], ['off', 'No model: only what Cortex can prove']]
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
  // "Who checks" has four long options, so it stays a menu; every other choice is one press: its options sit side
  // by side with the current one marked (the engine has no switch element, and a Button can't hold a drawing).
  const field = (key: string, label: string, options: [string, string][], value: string, short: string, full = '', warn = false) => (
    <Box key={`st-${key}`} flexDirection="column" gap={0} paddingY={1} hover={{ scope: `hs-${key}` }}>
      {Select
        ? <Select key={`sel-${key}`} label={label} value={value} options={options.map(([v, l]) => ({ value: v, label: l }))} onSelect={v => save(key, v)} />
        : <Box flexDirection="row" gap={1} flexWrap="wrap"><Text color={K.text}>{label}</Text>{options.map(([v, l]) => <Button key={`opt-${key}-${v}`} variant={v === value ? 'primary' : 'secondary'} onPress={() => save(key, v)}>{l}</Button>)}</Box>}
      {help(key, short, full, warn)}
    </Box>
  )
  const pick = (key: string, label: string, options: [string, string][], value: string, short: string, full = '', warn = false) => (
    <Box key={`st-${key}`} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" paddingY={1} hover={{ scope: `hs-${key}` }}>
      <Box flexDirection="column" gap={0} width="50%" flexGrow={1} flexShrink={1} minWidth={22}>
        <Text weight="medium" color={K.text}>{label}</Text>
        {help(key, short, full, warn)}
      </Box>
      {/* one control, not loose buttons: a borderless track (a bordered Box gets a card's padding and doubles the
          height), each option bare text in its own cell, the chosen cell filled emerald so it reads as the pill */}
      <Box key={`trk-${key}`} flexDirection="row" flexShrink={0} alignItems="center" backgroundColor={K.pill}>
        {options.map(([v, l]) => (
          <Box key={`optb-${key}-${v}`} paddingX={1} alignItems="center" {...(v === value ? { backgroundColor: `${K.emerald}38` } : {})}>
            <Button key={`opt-${key}-${v}`} plain onPress={() => { if (v !== value) save(key, v) }}>
              <Text size="caption" weight={v === value ? 'semibold' : 'medium'} color={v === value ? K.emerald : K.label}>{l}</Text>
            </Button>
          </Box>
        ))}
      </Box>
    </Box>
  )
  const text = (key: string, label: string, value: string, placeholder: string) => Input
    ? <Input key={`in-${key}`} label={label} value={value} placeholder={placeholder} submitLabel="Save" onSubmit={v => save(key, v.trim())} />
    : <Text key={`in-${key}`} size="caption" color={K.label}>{`${label}: ${value || 'not set'} (set with: kc prefs set ${key} <value>)`}</Text>
  const w = '100%' // each card fills its column
  // each card's header carries a small mascot doing that card's job (the icon disc where drawings can't show)
  const sec = (key: string, icon: string, title: string, sub: string, children: (JSX.Element | null)[], accent?: string, mini?: Mini) => u.card(key, w, [
    <Box key={`${key}-h`} flexDirection="row" gap={1} alignItems="center">
      {mini && u.Svg ? <Box key={`${key}-m`} flexShrink={0}>{u.graphic(`${key}-n`, miniSvg(mini, 36), `Cortex ${({ handoff: 'holding a note', dream: 'asleep under the moon', safety: 'with a shield', you: 'waving hello' })[mini]}`)}</Box> : u.node(`${key}-n`, icon, accent ?? K.emerald, 22)}
      <Box flexDirection="column"><Text weight="semibold" color={K.text}>{title}</Text><Text size="caption" color={K.muted}>{sub}</Text></Box>
    </Box>,
    ...children,
  ])
  const be = pr.dreamBackend ?? 'claude'
  const [short, full] = BACKEND_HELP[be] ?? BACKEND_HELP.claude!
  const at = pr.handoffAt ?? 80
  const warns = s.safety?.findings.filter(x => x.level === 'warn').length ?? 0
  const safety = s.safety ? sec('sec-safe', 'rule', 'Safety for long runs', warns ? `${warns} of these need${warns === 1 ? 's' : ''} a fix before you let Claude run on its own` : 'For auto mode and long background sessions', [
    ...s.safety.findings.map(x => (
      <Box key={`sf-${x.id}`} flexDirection="row" gap={1} alignItems="flex-start" paddingY={1}>
        {u.node(`sf-${x.id}-n`, x.level === 'ok' ? 'check' : x.level === 'warn' ? 'alert' : 'pending', x.level === 'ok' ? K.emerald : x.level === 'warn' ? K.amber : K.silver, 20)}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={16} gap={0}>
          <Text weight="medium" color={K.text}>{x.title}</Text>
          <Text size="caption" color={K.label}>{x.detail}</Text>
        </Box>
        {x.fix ? <Button key={`sf-fix-${x.id}`} variant={x.level === 'warn' ? 'primary' : 'secondary'} onPress={() => { void act($, x.fix === 'gate' ? 'Check added' : 'Secrets protected', ['safety', 'apply', x.fix!]) }}>{x.fix === 'gate' ? 'Add the check' : 'Protect them'}</Button> : null}
      </Box>
    )),
    <Box key="sf-foot" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
      <Text size="caption" color={K.muted}>Each fix is saved in this project's .claude/settings.json and applies to new chats.</Text>
      {s.safety.undo ? <Button key="sf-undo" variant="secondary" onPress={() => { void act($, 'Undone', ['safety', 'undo']) }}>Undo</Button> : null}
    </Box>,
  ], warns ? K.amber : undefined, 'safety') : null
  const hand = sec('sec-hand', 'link', 'Handoff', 'Your place, saved so a new chat can pick it up', [
        pick('tokenMode', 'How much to carry over', MODES, pr.tokenMode, MODE_HELP[pr.tokenMode] ?? ''),
        pick('handoffAt', 'Suggest a fresh chat at', [['70', '70% full'], ['80', '80% full'], ['90', '90% full']], String(at), `Cortex asks at ${at}% (or ${at - 10}% if the cache is cold). You always confirm.`, 'Yes saves the handoff and copies /cortex-resume for you to paste in a new chat. Later waits 30 minutes or 5 more points.'),
        <Text key="st-cost" size="caption" color={K.muted}>{`The current handoff is about ${(pr.tokens?.handoff ?? 0).toLocaleString()} tokens, saved after every reply.`}</Text>,
      ], undefined, 'handoff')
  // tools (MCP servers) get their own small card: what turns them off, and what is off here
  const tools = sec('sec-tools', 'link', 'Tools', 'MCP servers that load into every message', [
        pick('autoPark', 'Turn off tools you never use', ONOFF, pr.autoPark === false ? 'off' : 'on', pr.autoPark === false ? 'Off: you turn them off yourself, on the Costs page.' : 'On: a tool unused in 10 chats stops loading in new ones.', 'Uses Claude Code\'s own per-project switch (the one /mcp writes), never the Claude app\'s own servers. One press brings a tool back. Each one off stops adding its tool names and instructions to every message.'),
        ...((s.parked?.servers ?? []).length ? [<Box key="st-pk" flexDirection="row" justifyContent="space-between" columnGap={1} rowGap={1} flexWrap="wrap" alignItems="center">
          <Box flexShrink={1} minWidth={16}><Text size="caption" color={K.label}>{`Off here: ${s.parked!.servers.map(x => toolName(x).replace(/^a connector$/, 'a claude.ai account connector').replace(/_/g, ' ')).join(', ')}`}</Text></Box>
          <Button key="st-unpark" variant="secondary" onPress={() => { void act($, 'Back on', ['park', 'remove', ...s.parked!.servers.map(x => x.name)]) }}>Turn back on</Button>
        </Box>] : []),
      ], undefined, 'handoff')
  const dream = sec('sec-dream', 'dream', 'Dream', 'A deep check that Claude\'s notes still match what really happened', [
        pick('quickCheck', 'Quick check after every turn', ONOFF, pr.quickCheck === false ? 'off' : 'on', pr.quickCheck === false ? 'Off: it runs only when you press Quick check.' : 'On: a free, instant check for broken links, missing files and repeats.', 'It runs in the background when your memory files change, then shows what it found on the Dream page with Apply and Keep buttons. Your turns stay as fast as before.'),
        pick('autoDream', 'Run a full Dream by itself', ONOFF, pr.autoDream ? 'on' : 'off', pr.autoDream ? 'On: at most once a day, after 3 new chats.' : 'Off: a Dream runs only when you press Dream now.', 'It only suggests: nothing changes until you press Apply. An automatic Dream never changes a file. It saves what it found, and the strip shows how many notes wait for you.'),
        field('dreamBackend', 'Who judges a Dream', BACKENDS, be, short, full),
        be === 'claude' ? pick('dreamModel', 'Model', [['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']], pr.dreamModel || 'sonnet', 'Sonnet is the best balance of care and cost.', 'Haiku is faster and finds less; Opus is the most careful and uses the most of your plan.') : null,
        be === 'opencode' ? text('dreamModel', 'OpenCode model (provider/model)', pr.dreamModel ?? '', 'opencode/deepseek-v4.1-flash-free') : null,
        be === 'api' ? pick('dreamApi', 'Provider', [['anthropic', 'Anthropic'], ['openai', 'OpenAI-compatible']], pr.dreamApi ?? 'anthropic', 'Where your key is from. OpenAI-compatible covers OpenRouter, Groq and others.') : null,
        be === 'api' ? text('dreamModel', 'Model name', pr.dreamModel ?? '', 'e.g. claude-sonnet-5-5') : null,
        be === 'api' && pr.dreamApi === 'openai' ? text('dreamUrl', 'Endpoint', pr.dreamUrl ?? '', 'https://openrouter.ai/api/v1') : null,
        pick('dreamTranscripts', 'Recent chats a Dream reads', [['5', '5'], ['10', '10'], ['20', '20']], String(pr.dreamTranscripts ?? 10), 'More chats find more, and use a little more of your plan.'),
      ], undefined, 'dream')
  const you = sec('sec-you', 'star', 'You', 'How Cortex greets you', [
        pick('greeting', 'Greet me by name', ONOFF, pr.greeting === false ? 'off' : 'on', pr.greeting === false ? 'Off: the panel shows the project name instead.' : `On: ${s.name ? `"${(h => (h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'))(new Date().getHours())}, ${s.name}"` : 'no name found yet; set one below'}.`, 'The name comes from the box below, or else your computer account\'s first name. It stays on this computer and never goes into your project.'),
        pick('sound', 'Sounds', ONOFF, pr.sound === false ? 'off' : 'on', pr.sound === false ? 'Off: notifications show without a sound.' : 'On: a soft chime when a handoff is saved or a Dream finishes.', 'Cortex\'s own two short sounds (a rising chime for done, two low notes when something needs you). Settings changes never chime.'),
        text('name', 'Your name (optional)', pr.name ?? '', s.name || 'e.g. Kafil'),
        <Text key="st-scope" size="caption" color={K.muted}>{pr.overridden.length ? `Settings are saved on this computer. This project has its own: ${pr.overridden.join(', ')}.` : 'Settings are saved on this computer and used in every project.'}</Text>,
        <Box key="st-intro" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap"><Text size="caption" color={K.label}>New here? The three-step intro shows what Cortex does.</Text><Button key="st-intro-b" variant="secondary" onPress={() => { void replayIntro($) }}>Show the intro again</Button></Box>,
      ], undefined, 'you')
  // wide: two columns of cards, so a short card never stretches to its neighbour's height
  const col = (key: string, kids: (JSX.Element | null)[]) => <Box key={key} width="45%" flexGrow={1} minWidth={24} flexDirection="column" gap={1}>{kids}</Box>
  return (
    <Box flexDirection="column" gap={1}>
    {u.intro('st-in', sceneSvg('settings', 100), 'Cortex adjusting its preferences', 'Settings', 'Every change is saved the moment you press it.', companion('cool', 800))}
    {wide
      ? <Box key="st" flexDirection="row" gap={1} alignItems="flex-start">{col('st-a', [warns ? safety : hand, dream])}{col('st-b', [warns ? hand : safety, tools, you])}</Box>
      : <Box key="st" flexDirection="column" gap={1}>{warns ? safety : null}{hand}{tools}{dream}{warns ? null : safety}{you}</Box>}
    </Box>
  )
}
