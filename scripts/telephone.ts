// The 5-hop telephone game: five consecutive chats on one task, each started with /cortex-resume, driven through the
// real plugin hook (claude-plugin/cortex/hook.mjs, a process per turn, as Claude Code runs it). Chat 1 states a
// mandatory skill, a never-rule and a scope rule, and rejects an approach; later chats only say "continue", hit a usage
// limit, add one rule and pile up noise turns. What chat 5's packet still holds is the score.
// Used by `node scripts/benchmark.ts` and test/hardening-mission.test.ts. Writes only inside the folder it is given.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Turn { user: string; reply: string; edit?: string; test?: boolean; commit?: string; readPacket?: boolean }
export interface Probe { name: string; re: RegExp; where?: "contract" | "packet" }

const MUST_SKILL = "Use the stageshow skill fully via the Skill tool for every page mockup, not just its checklist file.";
const NEVER_MERGE = "Never merge into main until I review the before and after images.";
const SCOPE = "Keep v4.10 and v4.11 as unmerged branches.";
const LATER_RULE = "Always run npm run check before every commit.";

/** The five chats. Chat 1 says everything once; the rest only build on it. */
export function script(): Turn[][] {
  // the noise is what real chats say between the work: reports, reassurance and passing words full of the trigger words
  // a careless reader turns into rules, rejections or "the mission is done" (each one broke an early v4.5 draft)
  const SAID = [
    "I don't see the button on the settings page.", "It crashes without the network connection.", "It always crashes when I click save.",
    "Don't worry about the lint warnings for now.", "No problem, carry on with the next card.", "Work done in the last chat broke the build, please look at it.",
    "Nope, all good, ship it.", "I'm happy with the skills page now, nice work.", "Undo works now, thanks.", "Wrong file was open on my side, carry on.",
    "Project complete means tests pass on every page, so check all six tabs.",
  ];
  const noise = (from: number, n: number): Turn[] => Array.from({ length: n }, (_, i) => ({ user: SAID[(from + i) % SAID.length]!, reply: `Fixed it (${from + i}); tests pass.`, edit: "src/cards.ts", test: true }));
  return [
    [
      { user: `Redesign the Cortex panel pages so they look better than main. ${MUST_SKILL} ${NEVER_MERGE} ${SCOPE}`, reply: "Plan: Overview first, then Costs, then Settings. Next: build the Overview page." },
      { user: "Start with the Overview page.", reply: "Built Overview v1: I tinted the card backgrounds.", edit: "src/overview.ts", test: true },
      { user: "reject, you have made tinted bg in this and nothing else changed, this is a downgrade not an upgrade", reply: "Understood. I reverted the tinted backgrounds. Next: redo Overview from a stageshow mockup." , edit: "src/overview.ts" },
      { user: "Good. Commit it and move on.", reply: "Committed the Overview layout. Next: build the Costs page.", commit: "overview: new layout from the mockup", test: true },
    ],
    [
      { user: "/cortex-resume", reply: "Picking up: the Overview is done; next is the Costs page.", readPacket: true },
      { user: "continue", reply: "Built the Costs page from its mockup and committed it. Next: the Settings page.", edit: "src/costs.ts", test: true, commit: "costs: page from the mockup" },
      ...noise(1, 6),
    ],
    [
      { user: "The 5-hour limit has reset. /cortex-resume", reply: "Picking up: Costs is done; next is the Settings page.", readPacket: true },
      { user: "continue", reply: "Settings page half done: the card order is set.", edit: "src/settings.ts" },
    ],
    [
      { user: "/cortex-resume", reply: "Picking up: Settings is half done (the card order is set).", readPacket: true },
      { user: `Finish Settings. ${LATER_RULE}`, reply: "Settings is finished and committed. Next: the before and after images for your review.", edit: "src/settings.ts", test: true, commit: "settings: finished" },
      ...noise(7, 5),
    ],
    [
      { user: "/cortex-resume", reply: "Picking up: all three pages are done; next is the before and after images for your review.", readPacket: true },
    ],
  ];
}

/** What chat 5 must still know. */
export const PROBES: Probe[] = [
  { name: "mandatory skill (chat 1, verbatim)", re: /\[skill\/workflow\] “Use the stageshow skill fully via the Skill tool for every page mockup/, where: "contract" },
  { name: "never-rule (chat 1, verbatim)", re: /\[never\] “Never merge into main until I review the before and after images\.”/, where: "contract" },
  { name: "scope rule (chat 1, verbatim)", re: /“Keep v4\.10 and v4\.11 as unmerged branches\.”/, where: "contract" },
  { name: "rejected approach and why (chat 1)", re: /## Mission contract[\s\S]*\*\*Rejected[\s\S]*tinted the card backgrounds[\s\S]*the user: “reject, you have made tinted bg/, where: "contract" },
  { name: "rule added in chat 4", re: /“Always run npm run check before every commit\.”/, where: "contract" },
  { name: "north star is chat 1's goal", re: /\*\*North star:\*\* Redesign the Cortex panel pages so they look better than main/, where: "contract" },
  { name: "lineage: hop 5, origin chat 1", re: /cortex-lineage: [^>]*hop=5 [^>]*origin=chat-1 /, where: "contract" },
  { name: "progress: chat 4's committed work carried", re: /Continued from[^\n]*\n[\s\S]*Settings is finished and committed/, where: "packet" },
  { name: "progress: the next step is the newest one", re: /## Next action\n[^\n]*before and after images/, where: "packet" },
  { name: "a usage limit never became the goal or a result", re: /^(?![\s\S]*(?:## Goal\n[^\n]*hit your 5-hour limit|→ You've hit your))/, where: "packet" },
  { name: "no false rules from reports and reassurance", re: /^(?![\s\S]*(?:I don't see the button|crashes without the network|always crashes when|Don't worry about the lint|happy with the skills page))/, where: "contract" },
  { name: "no false rejections (exactly one)", re: /\*\*Rejected[^\n]*\n- [^\n]*\n(?!- )/, where: "contract" },
  { name: "the mission is still active after 'work done…' and 'project complete…'", re: /status=active -->/, where: "contract" },
];

let clock = Date.parse("2026-11-20T09:00:00Z");
const stamp = () => new Date((clock += 61_000)).toISOString();
const line = (o: object) => JSON.stringify(o) + "\n";

/** Runs the five chats against `hook` in the project at `root` (a git repo with Cortex on). Returns chat 5's packet. */
export function runTelephone(root: string, hook: string, env: NodeJS.ProcessEnv = process.env): { packet: string; perChat: string[]; ms: number[] } {
  clock = Date.parse("2026-11-20T09:00:00Z");
  // chat 3 ends on a simulated usage limit: the real hook would answer it with a real macOS notification, so this script
  // never lets one out, whoever calls it (the temp-folder guard in notify-guard.ts would stop it too)
  env = { ...env, CORTEX_NO_NOTIFY: "1" };
  const run = (event: string, input: object) => {
    const t = performance.now();
    const r = spawnSync(process.execPath, [hook, event, "--plugin"], { input: JSON.stringify(input), env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`hook ${event} exited ${r.status}: ${r.stderr}`);
    return performance.now() - t;
  };
  const git = (...a: string[]) => spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
  const perChat: string[] = [], ms: number[] = [];
  script().forEach((turns, c) => {
    const session = `chat-${c + 1}`;
    const tp = join(root, `.t-${session}.jsonl`);
    writeFileSync(tp, "");
    let last = "";
    turns.forEach((t, i) => {
      const u = `${session}-u${i}`;
      const isCmd = /^\/cortex-resume$/.test(t.user.trim());
      const content = isCmd ? "<command-message>kapex-cortex:cortex-resume</command-message>\n<command-name>/kapex-cortex:cortex-resume</command-name>" : t.user;
      appendFileSync(tp, line({ type: "user", uuid: u, parentUuid: last || undefined, timestamp: stamp(), message: { role: "user", content } }));
      last = u;
      const tools: object[] = [];
      if (t.readPacket) {
        // the model reads the packet, as /cortex-resume tells it to: the hook sees which chat's packet it was
        let packet = "";
        try { packet = readFileSync(join(root, ".vault", "STATE.md"), "utf8"); } catch { /* none yet */ }
        appendFileSync(tp, line({ type: "assistant", uuid: `${u}-r`, parentUuid: last, timestamp: stamp(), message: { role: "assistant", content: [{ type: "tool_use", id: `${u}-read`, name: "Read", input: { file_path: join(root, ".vault", "STATE.md") } }] } }));
        appendFileSync(tp, line({ type: "user", uuid: `${u}-rr`, parentUuid: `${u}-r`, timestamp: stamp(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: `${u}-read`, content: packet }] } }));
        last = `${u}-rr`;
      }
      if (t.edit) { writeFileSync(join(root, t.edit), `// ${session} turn ${i}\n`); tools.push({ type: "tool_use", id: `${u}-e`, name: "Edit", input: { file_path: join(root, t.edit) } }); }
      if (t.test) tools.push({ type: "tool_use", id: `${u}-t`, name: "Bash", input: { command: "npm test" } });
      if (t.commit) { git("add", "-A"); git("commit", "-q", "-m", t.commit); tools.push({ type: "tool_use", id: `${u}-c`, name: "Bash", input: { command: `git commit -m "${t.commit}"` } }); }
      if (tools.length) {
        appendFileSync(tp, line({ type: "assistant", uuid: `${u}-a1`, parentUuid: last, timestamp: stamp(), message: { role: "assistant", content: tools, usage: { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0 } } }));
        appendFileSync(tp, line({ type: "user", uuid: `${u}-a1r`, parentUuid: `${u}-a1`, timestamp: stamp(), message: { role: "user", content: tools.map((x) => ({ type: "tool_result", tool_use_id: (x as { id: string }).id, content: "ok" })) } }));
        last = `${u}-a1r`;
      }
      appendFileSync(tp, line({ type: "assistant", uuid: `${u}-a`, parentUuid: last, timestamp: stamp(), message: { role: "assistant", content: [{ type: "text", text: t.reply }], usage: { input_tokens: 10, output_tokens: 80, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0 } } }));
      last = `${u}-a`;
      ms.push(run("claude.stop", { session_id: session, transcript_path: tp, cwd: root, last_assistant_message: t.reply }));
    });
    // chat 3 ends on a usage limit: the harness's notice must never become the goal, the reply or a turn's result
    if (c === 2) {
      const notice = "You've hit your 5-hour limit · resets 12am (Asia/Calcutta)";
      appendFileSync(tp, line({ type: "user", uuid: `${session}-lim`, parentUuid: last, timestamp: stamp(), message: { role: "user", content: "keep going with the settings page" } }));
      appendFileSync(tp, line({ type: "assistant", uuid: `${session}-lim-a`, parentUuid: `${session}-lim`, timestamp: stamp(), isApiErrorMessage: true, message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: notice }], usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }));
      run("claude.stopfailure", { session_id: session, transcript_path: tp, cwd: root, error: "rate_limit", last_assistant_message: notice });
    }
    let packet = "";
    try { packet = readFileSync(join(root, ".vault", "STATE.md"), "utf8"); } catch { /* no packet written: scored as nothing kept */ }
    perChat.push(packet);
  });
  return { packet: perChat.at(-1) ?? "", perChat, ms };
}

/** A fresh git repo with Cortex on, for one run. */
export function telephoneRepo(root: string): void {
  mkdirSync(join(root, ".vault", "private"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, ".vault", "cortex.json"), JSON.stringify({ version: 3 }));
  writeFileSync(join(root, ".gitignore"), ".vault/private/\n.vault/STATE.md\n.t-*.jsonl\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "panel", scripts: { check: "tsc && node --test" } }));
  writeFileSync(join(root, "src", "overview.ts"), "export {}\n");
  spawnSync("git", ["init", "-q", "-b", "main", root]);
  spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
  spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
}

/** Scores a packet: which probes it passes. The contract probes look only inside the Mission contract section. */
export function score(packet: string): { name: string; ok: boolean }[] {
  const contract = /## Mission contract[\s\S]*?(?=\n## (?!Mission))/.exec(packet)?.[0] ?? "";
  return PROBES.map((p) => ({ name: p.name, ok: p.re.test(p.where === "contract" ? contract || "" : packet) }));
}

/** Format-free retention: is each of chat 1's facts (and chat 4's rule, and the newest step) anywhere in the packet?
 * Fair to any version of Cortex, including ones without a Mission contract (the "before" line of the benchmark). */
export const FACTS: [string, RegExp][] = [
  ["chat 1: mandatory skill", /stageshow skill fully via the Skill tool/],
  ["chat 1: never-rule", /Never merge into main until I review/],
  ["chat 1: scope rule", /Keep v4\.10 and v4\.11 as unmerged branches/],
  ["chat 1: rejected approach, the user's words", /tinted bg in this and nothing else changed/],
  ["chat 1: goal", /Redesign the Cortex panel pages/],
  ["chat 4: added rule", /Always run npm run check before every commit/],
  ["chat 5: newest next step", /## Next action\n[^\n]*before and after images/],
];
export const retained = (packet: string) => FACTS.map(([name, re]) => ({ name, ok: re.test(packet) }));
