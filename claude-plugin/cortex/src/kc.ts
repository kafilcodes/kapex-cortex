// The `kc` shortcut layer: short commands on top of `cortex`.
const ALIASES: Record<string, string[]> = {
  i: ["start"], // set up the machine if needed + turn on this project
  s: ["status"],
  h: ["handoff"],
  r: ["state"], // what to resume from
  m: ["memory"], // Claude Code's memory files and what they cost
  d: ["dream"],
  b: ["bench"],
};

export function expandAlias(argv: string[]): string[] {
  const [cmd, ...rest] = argv;
  return cmd && ALIASES[cmd] ? [...ALIASES[cmd], ...rest] : argv;
}

export const KC_HELP = `kc — Kapex Cortex

  kc i            turn Cortex on in this project (sets up this computer the first time)
  kc s            status: handoff, memory loaded every session, last Dream
  kc h            save a handoff now        kc r     show the handoff a new chat resumes from
  kc m            Claude Code's memory files: what loads every session, and what it costs
  kc d            Dream in the background: check memory against real sessions, tests and git
  kc d run        Dream now and wait (add --no-model for the checks a program can do alone)
  kc d show [id]  what a Dream found        kc d apply <id> / discard <id> / undo <id>
  kc d skip <id> <finding> [off]           leave one finding out of Apply (off = put it back)
  kc safety       secrets, sandbox and a check before Claude finishes  ·  kc safety apply secrets|gate  ·  kc safety undo
  kc prefs set <key> <value>               settings: dreamModel, dreamBackend, dreamTranscripts, autoDream, tokenMode

In Claude Code: /kc opens the panel. In a new chat, or OpenCode after a usage limit: /cortex-resume.
`;
