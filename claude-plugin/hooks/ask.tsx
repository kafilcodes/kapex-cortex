import { atom, read, update, type ElementTable } from 'claude-code'

import type { AskView } from '../types'
import type { Dollar } from './data'
import { K } from './theme'

// A panel button never starts a turn by itself. You may be mid-task in this chat, and a prompt sent from the panel
// would land in it and use its context. So a button that would send a prompt (Load into this chat, the Elephant–Goldfish
// check, Ask Claude about a memory note) only asks: put it in your message box (to read, edit, then press Enter),
// send it now, copy it for a new chat, or cancel. Nothing is sent until you choose.

export const asking = atom({ plugin: 'kapex-cortex', key: 'asking' } as const, null as AskView | null, { shape: 'asking-1' })

export async function readAsk($: Dollar): Promise<AskView | null> { try { return await read($, asking) } catch { return null } }
/** Opens the choice for one button (pressing it again closes it). */
export async function ask($: Dollar, id: string, what: string, text: string): Promise<void> {
  await update($, asking, a => (a?.id === id ? null : { id, what, text }))
}
async function done($: Dollar): Promise<void> { await update($, asking, () => null).catch(() => undefined) }
function toast($: Dollar, t: string): void { try { $.ui.toast(t, { timeoutMs: 4_500 }) } catch { /* no toasts here */ } }

/** Into the message box: after what you typed (never over it), not sent. */
export async function putInBox($: Dollar, text: string): Promise<boolean> {
  try {
    const box = await $.prompt.read()
    const had = !!box.text.trim()
    const r = await $.prompt.fill({ text: had ? `\n\n${text}` : text, mode: had ? 'append' : 'replace' })
    if (r.isFilled) { toast($, 'In your message box: read it, then press Enter to start'); return true }
  } catch { /* fall through */ }
  toast($, 'Couldn\'t reach the message box here: use Copy instead')
  return false
}

/** The choice under the button that asked: four plain buttons and one line saying nothing has been sent. */
export function askRow($: Dollar, els: ElementTable, a: AskView | null, id: string): JSX.Element | null {
  if (!a || a.id !== id) return null
  const { Box, Text, Button } = els
  const k = (x: string) => `ask-${id}-${x}`
  return (
    <Box key={k('row')} flexDirection="column" gap={1} paddingX={2} paddingY={1} backgroundColor={`${K.emerald}14`}>
      <Text size="caption" color={K.text}>{`Start “${a.what}”? Nothing is sent until you choose. If you are mid-task here, a new chat keeps this one's context clean.`}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Button key={k('box')} variant="primary" onPress={() => { void putInBox($, a.text).then(() => done($)) }}>Put in message box</Button>
        <Button key={k('send')} variant="secondary" onPress={() => { void $.prompt.submit({ text: a.text }); void done($) }}>Send now</Button>
        <Button key={k('copy')} variant="secondary" onPress={() => {
          void (async () => {
            let ok = false
            try { ok = !!(await $.ui.copy({ text: a.text })).isCopied } catch { /* no clipboard */ }
            toast($, ok ? 'Copied: open a new chat and paste it there' : 'Couldn\'t copy here')
            await done($)
          })()
        }}>Copy for a new chat</Button>
        <Button key={k('no')} plain onPress={() => { void done($) }}><Text size="caption" color={K.label}>Cancel</Text></Button>
      </Box>
    </Box>
  )
}
