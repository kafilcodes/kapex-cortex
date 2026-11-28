// The `kc` shortcut layer: short commands on top of `cortex`.
const ALIASES: Record<string, string[]> = {
  i: ["start"], // set up the machine if needed + turn on this project
  s: ["status"],
  h: ["handoff"],
  r: ["state"], // what to resume from
  m: ["memory"], // Claude Code's memory files and what they cost
  d: ["dream"],
  c: ["dream"], // v4.6: the Memory check (kc d and kc dream keep working)
  check: ["dream"],
  b: ["bench"],
};

export function expandAlias(argv: string[]): string[] {
  const [cmd, ...rest] = argv;
  return cmd && ALIASES[cmd] ? [...ALIASES[cmd], ...rest] : argv;
}

export const KC_HELP = `kc — Kapex Cortex

  kc i            turn Cortex on in this project (sets up this computer the first time)
  kc s            status: handoff, memory loaded every session, last memory check
  kc h            save a handoff now        kc r     show the handoff a new chat resumes from
  kc m            Claude Code's memory files: what loads every session, and what it costs
  kc c            Memory check in the background: test what Claude remembers against your code, tests and git
  kc c run        run a full check and wait (add --no-model for the checks a program can do alone)
  kc c show [id]  what a check found        kc c apply <id> / discard <id> / undo <id>
  kc c skip <id> <finding> [off]           leave one finding out of Apply (off = put it back)
                  (kc d and kc dream are the same command, as before v4.6)
  kc mission      the mission's steps and ticks  ·  kc mission done <n>  ·  add "…"  ·  drop <n>  ·  close
  kc safety       secrets, sandbox and a check before Claude finishes  ·  kc safety apply secrets|gate  ·  kc safety undo
  kc prefs set <key> <value>               settings: dreamModel, dreamBackend, dreamTranscripts, autoDream, tokenMode

In Claude Code: /kc opens the panel. In a new chat, or OpenCode after a usage limit: /cortex-resume.
`;
