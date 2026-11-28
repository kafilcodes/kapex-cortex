import type { ElementTable } from 'claude-code'

import type { StatusView } from '../types'
import { act, ago, copyResume, minsSince, type Dollar } from './data'
import type { Kit } from './kit'
import { K } from './theme'

// The Handoff page's way out when Claude's usage limit is reached: carry on in OpenCode with a free model. It reads
// the same handoff (/cortex-resume there), and when an OpenCode 2 session ends a turn Cortex saves the handoff back,
// so Claude Code picks up where OpenCode stopped. The card says which of those works on this computer, in this
// project, and offers the one press that fixes what doesn't (setting the project up, or copying the command).

export function opencodeCard($: Dollar, els: ElementTable, u: Kit, s: StatusView): JSX.Element {
  const { Box, Text, Button } = els
  const oc = s.opencode ?? { installed: false, plugin: false }
  const v = oc.version ? `OpenCode ${oc.version}` : 'OpenCode'
  const old = oc.major === 1
  // an older core reports no `command`: its set-up always wrote the command with the plugin, so the plugin vouches for it
  const cmd = oc.command ?? oc.plugin
  const ready = oc.installed && cmd && (oc.plugin || old)
  // the last time OpenCode handed the work back here (an earlier handoff saved from OpenCode)
  const back = s.history?.states.find(x => x.from === 'opencode')
  const step = (n: string, t: string) => <Box key={`oc-s${n}`} flexDirection="row" gap={1} alignItems="flex-start"><Text size="caption" weight="semibold" color="success">{n}</Text><Text size="caption" color={K.text}>{t}</Text></Box>
  const status = !oc.installed ? null
    : !cmd ? u.tag('oc-st', 'alert', K.amber, `${v} is installed, but this project isn't set up for it yet.`, K.text)
    : !oc.plugin && !old ? u.tag('oc-st', 'alert', K.amber, `${v} can read the handoff here, but can't hand the work back yet: set it up again.`, K.text)
    : u.tag('oc-st', 'check', K.emerald, `Ready: ${v} reads this handoff${old ? '' : ' and hands the work back when it stops'}.`, K.text)
  return u.card('h-oc', '100%', [
    u.head('h-oc-h', 'Out of Claude for now? Carry on in OpenCode', back ? `it last handed back ${ago(minsSince(back.at))}` : 'free models, the same handoff'),
    status,
    <Box key="oc-steps" flexDirection="column" gap={0}>
      {oc.installed ? null : step('1', 'Install OpenCode (opencode.ai): its free models cost nothing.')}
      {step(oc.installed ? '1' : '2', 'Open OpenCode in this project\'s folder.')}
      {step(oc.installed ? '2' : '3', 'Type /cortex-resume: it reads the goal, your decisions and the last replies from this handoff.')}
      {step(oc.installed ? '3' : '4', old ? 'Before you stop there, type /cortex-handoff so Claude Code can carry on (OpenCode 1.x can\'t save it back by itself).' : 'When it stops, Cortex saves the handoff back here, so Claude Code carries on with /cortex-resume.')}
    </Box>,
    <Box key="oc-act" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
      <Text size="caption" color={K.muted}>{old ? 'Updating to OpenCode 2 lets it hand the work back by itself.' : 'Both read the same file in this folder, .vault/STATE.md.'}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {oc.installed && !ready ? <Button key="oc-setup" variant="primary" onPress={() => { void act($, 'OpenCode set up', ['i']) }}>Set up OpenCode here</Button> : null}
        <Button key="oc-copy" variant="secondary" onPress={() => { void copyResume($) }}>Copy /cortex-resume</Button>
      </Box>
    </Box>,
  ])
}
