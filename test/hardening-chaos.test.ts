import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { parseStatus } from "../src/core/gitinfo.ts";
import { readMissionRecord } from "../src/core/mission.ts";
import { parseLine } from "../src/core/transcript.ts";
import { readTurns } from "../src/core/turns.ts";
import { repoPaths } from "../src/core/paths.ts";
import { statePath, stateAgeNotice } from "../src/core/state.ts";
import { telephoneRepo } from "../scripts/telephone.ts";
import { CLI, ROOT, tmpRepo } from "./helpers.ts";
import { claudeProjectDir } from "../src/core/home.ts";

// v4.5 chaos suite: what real machines do to Cortex. Every case asserts the hook exits 0 (it never breaks the
// harness) and the handoff it leaves is whole and right.
const HOOK = join(ROOT, "claude-plugin", "cortex", "hook.mjs");
const hook = (event: string, input: object, extra: string[] = []) => spawnSync(process.execPath, [...extra, HOOK, event, "--plugin"], { input: JSON.stringify(input), encoding: "utf8" });
const hookAsync = (event: string, input: object) => new Promise<number>((res) => {
  const c = spawn(process.execPath, [HOOK, event, "--plugin"], { stdio: ["pipe", "ignore", "ignore"] });
  c.on("exit", (code) => res(code ?? -1));
  c.stdin.end(JSON.stringify(input));
});
const ts = (min: number) => new Date(Date.parse("2026-11-20T09:00:00Z") + min * 60_000).toISOString();
const say = (file: string, uuid: string, min: number, text: string) => appendFileSync(file, JSON.stringify({ type: "user", uuid, timestamp: ts(min), message: { role: "user", content: text } }) + "\n");
const whole = (packet: string) => /^# STATE — /.test(packet) && /## Mission contract/.test(packet) && /## Next action/.test(packet) && !/truncated for length/.test(packet);

test("8 chats in one repo ending turns at the same moment, 3 rounds: every chat's packet is written, none torn, no lost lineage", async () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-race-"));
  telephoneRepo(root);
  const p = repoPaths(root);
  const sessions = Array.from({ length: 8 }, (_, i) => `race-${i}`);
  for (let round = 0; round < 3; round++) {
    for (const [i, s] of sessions.entries()) say(join(root, `${s}.jsonl`), `${s}-${round}`, round * 10 + i, `Chat ${i} round ${round}: build part ${i}. Never break part ${i}.`);
    const codes = await Promise.all(sessions.map((s) => hookAsync("claude.stop", { session_id: s, transcript_path: join(root, `${s}.jsonl`), cwd: root, last_assistant_message: `Round ${round} done for ${s}.` })));
    assert.deepEqual(codes, sessions.map(() => 0));
  }
  for (const s of sessions) {
    const own = readFileSync(join(p.states, `${s}.md`), "utf8");
    assert.ok(whole(own), `${s}'s packet is whole`);
    assert.match(own, new RegExp(`Round 2 done for ${s}`), `${s}'s last turn is in its own packet (the v4.4 lock lost it)`);
    assert.equal(readMissionRecord(p, s)?.mission.pins.length, 1);
    assert.equal(readTurns(p, s).length, 3);
  }
  const shared = readFileSync(statePath(p), "utf8");
  assert.ok(whole(shared) && sessions.some((s) => shared.includes(`· session ${s}`)), "STATE.md is one chat's whole packet");
  // an orphaned temp file is one whose writer is gone (a background Quick check may be mid-write right now: fine)
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const leftovers = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? leftovers(join(dir, d.name)) : /\.nosync$/.test(d.name) && !alive(Number(/\.(\d+)\.[0-9a-f]+\.nosync$/.exec(d.name)?.[1])) ? [d.name] : []);
  assert.deepEqual(leftovers(p.vault), [], "no orphaned temp files");
  assert.ok(Array.isArray(JSON.parse(readFileSync(join(p.priv, "hook-times.json"), "utf8"))), "the hook-times file is never torn");
  assert.equal(Object.keys(JSON.parse(readFileSync(join(p.priv, "carry.json"), "utf8"))).length, 8, "every chat's lineage decision kept");
  // a writer that holds the lock for long (a slow disk, a stalled sync): v4.4 then flagged the work dirty and never
  // wrote the waiting chat's own packet. Now the chat's packet is written anyway, and STATE.md catches up later.
  mkdirSync(join(p.priv, "locks"), { recursive: true });
  writeFileSync(p.viewsLock, `${process.pid} ${Date.now()} held`); // a live holder
  say(join(root, "slow.jsonl"), "slow-1", 99, "Chat slow: keep the importer streaming. Never buffer the whole file.");
  assert.equal(hook("claude.stop", { session_id: "slow", transcript_path: join(root, "slow.jsonl"), cwd: root, last_assistant_message: "Streaming importer kept." }).status, 0);
  assert.match(readFileSync(join(p.states, "slow.md"), "utf8"), /Streaming importer kept\./, "the waiting chat's turn is not lost");
  // a holder killed between creating and writing its lock leaves it empty: stale once it is old, by the file's age
  writeFileSync(p.viewsLock, "");
  const old = new Date(Date.now() - 60_000);
  utimesSync(p.viewsLock, old, old);
  assert.equal(hook("claude.stop", { session_id: "race-0", transcript_path: join(root, "race-0.jsonl"), cwd: root, last_assistant_message: "again" }).status, 0);
  assert.ok(!existsSync(p.viewsLock), "the old empty lock was cleared, not waited on");
  assert.ok(whole(readFileSync(statePath(p), "utf8")), "STATE.md promoted once the lock is free");
});

test("git extremes: detached HEAD, a rebase in progress, a repo with no commits, and a folder that is no repo all hand off cleanly", () => {
  // the parser on its own: detached and unborn
  assert.equal(parseStatus("# branch.oid abc1234def\n# branch.head (detached)\n").branch, "(detached at abc1234)");
  assert.equal(parseStatus("# branch.oid (initial)\n# branch.head main\n").head, null);
  const cases: [string, (root: string) => void, RegExp][] = [
    ["detached", (r) => { spawnSync("git", ["-C", r, "checkout", "-q", "--detach"]); }, /· \(detached at [0-9a-f]{7}\) ·/],
    ["rebase", (r) => { mkdirSync(join(r, ".git", "rebase-merge"), { recursive: true }); }, /\*\*Careful:\*\* a rebase is in progress/],
    ["merge", (r) => { writeFileSync(join(r, ".git", "MERGE_HEAD"), "0".repeat(40)); }, /a merge is in progress/],
  ];
  for (const [name, setup, expect] of cases) {
    const root = mkdtempSync(join(tmpdir(), `cortex-git-${name}-`));
    telephoneRepo(root);
    setup(root);
    const t = join(root, "t.jsonl");
    say(t, "u1", 0, "Fix the date parser. Never use regex for dates.");
    assert.equal(hook("claude.stop", { session_id: "g", transcript_path: t, cwd: root, last_assistant_message: "Done." }).status, 0, name);
    assert.match(readFileSync(statePath(repoPaths(root)), "utf8"), expect, name);
  }
  // no commits yet
  const unborn = tmpRepo();
  spawnSync("git", ["init", "-q", "-b", "main", unborn.root]);
  say(join(unborn.root, "t.jsonl"), "u1", 0, "Set up the project. Always use pnpm.");
  assert.equal(hook("claude.stop", { session_id: "u", transcript_path: join(unborn.root, "t.jsonl"), cwd: unborn.root, last_assistant_message: "Set up." }).status, 0);
  assert.match(readFileSync(statePath(unborn), "utf8"), /# STATE — [^\n]*· main ·[\s\S]*head=none/);
  // not a repository at all
  const plain = tmpRepo();
  say(join(plain.root, "t.jsonl"), "u1", 0, "Write notes. Never delete the drafts.");
  assert.equal(hook("claude.stop", { session_id: "n", transcript_path: join(plain.root, "t.jsonl"), cwd: plain.root, last_assistant_message: "Written." }).status, 0);
  assert.match(readFileSync(statePath(plain), "utf8"), /· no git ·[\s\S]*Not a git repository\./);
});

test("hostile transcript: corrupt and half-written lines, and a 50 MB file of base64 images, under a 64 MB heap", () => {
  assert.equal(parseLine('{"type":"user"'), null);
  assert.equal(parseLine("[1,2]"), null);
  assert.equal(parseLine("null"), null);
  const big = `{"type":"user","uuid":"img","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"${"A".repeat(300_000)}"}},{"type":"text","text":"what is in this picture?"}]}}`;
  assert.equal((parseLine(big)?.message as { content: { text?: string }[] }).content[1]!.text, "what is in this picture?");
  const p = tmpRepo();
  const t = join(p.root, "big.jsonl");
  say(t, "first", 0, "Describe each screenshot. Never upload them anywhere.");
  appendFileSync(t, "{not json at all\n\n[]\nnull\n{\"type\":\"user\"\n");
  const img = (i: number) => JSON.stringify({ type: "user", uuid: `img-${i}`, timestamp: ts(1 + i / 100), message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR".padEnd(2_000_000, "Q") } }, { type: "text", text: `screenshot ${i} attached` }] } }) + "\n";
  for (let i = 0; i < 25; i++) appendFileSync(t, img(i));
  say(t, "last", 9, "Now summarize all of them in one table.");
  appendFileSync(t, '{"type":"user","uuid":"half-writ'); // a line still being written
  const t0 = Date.now();
  // a 64 MB heap: v4.4 read the whole 50 MB file as one string and split it (several times the file in memory)
  const r = hook("claude.stop", { session_id: "big", transcript_path: t, cwd: p.root, last_assistant_message: "Table below." }, ["--max-old-space-size=64"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - t0 < 8_000, `took ${Date.now() - t0} ms`);
  const texts = readTurns(p, "big").map((x) => x.text);
  assert.equal(texts.length, 27, "every typed message, none of the corrupt lines");
  assert.equal(texts.at(-1), "Now summarize all of them in one table.");
  assert.ok(!texts.some((x) => x.length > 2_000), "no base64 stored");
});

test("missing, unreadable and locked paths never break a hook: it exits 0 and says why in errors.log", () => {
  const p = tmpRepo();
  // a transcript that doesn't exist, and one that can't be read
  assert.equal(hook("claude.stop", { session_id: "m", transcript_path: join(p.root, "nope.jsonl"), cwd: p.root, last_assistant_message: "x" }).status, 0);
  const locked = join(p.root, "locked.jsonl");
  say(locked, "u", 0, "hello there, keep going");
  chmodSync(locked, 0o000);
  assert.equal(hook("claude.stop", { session_id: "l", transcript_path: locked, cwd: p.root, last_assistant_message: "x" }).status, 0);
  chmodSync(locked, 0o644);
  // a private folder Cortex can't write
  const ro = tmpRepo();
  chmodSync(ro.priv, 0o500);
  say(join(ro.root, "t.jsonl"), "u", 0, "Build it. Never stop.");
  assert.equal(hook("claude.stop", { session_id: "r", transcript_path: join(ro.root, "t.jsonl"), cwd: ro.root, last_assistant_message: "x" }).status, 0);
  chmodSync(ro.priv, 0o755);
  // garbage on stdin, and no stdin at all
  assert.equal(spawnSync(process.execPath, [HOOK, "claude.stop", "--plugin"], { input: "{{{not json", encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, [HOOK, "claude.stop", "--plugin"], { input: "", encoding: "utf8" }).status, 0);
  // a folder that doesn't exist as the cwd
  assert.equal(hook("claude.stop", { session_id: "x", cwd: join(p.root, "gone", "deeper") }).status, 0);
  // the plugin reached through a symlinked folder: v4.4's hook compared paths as spelled and silently did nothing
  const link = join(mkdtempSync(join(tmpdir(), "cortex-link-")), "plugin");
  symlinkSync(join(ROOT, "claude-plugin", "cortex"), link, process.platform === "win32" ? "junction" : "dir"); // a junction needs no admin rights on Windows
  const sp = tmpRepo();
  say(join(sp.root, "t.jsonl"), "u", 0, "Ship the docs. Never publish drafts.");
  assert.equal(spawnSync(process.execPath, [join(link, "hook.mjs"), "claude.stop", "--plugin"], { input: JSON.stringify({ session_id: "ln", transcript_path: join(sp.root, "t.jsonl"), cwd: sp.root, last_assistant_message: "Shipped." }), encoding: "utf8" }).status, 0);
  assert.match(readFileSync(statePath(sp), "utf8"), /“Never publish drafts\.”/, "the hook ran through the link");
});

test("clock jumps: a packet from the future and messages out of order never give negative ages or a broken contract", () => {
  const p = tmpRepo();
  const t = join(p.root, "t.jsonl");
  say(t, "b", 30, "Second: never ship on Fridays.");
  say(t, "a", 10, "First: build the release script. Always tag releases.");
  assert.equal(hook("claude.stop", { session_id: "c", transcript_path: t, cwd: p.root, last_assistant_message: "ok" }).status, 0);
  assert.equal(readMissionRecord(p, "c")?.mission.pins.length, 2);
  writeFileSync(join(p.priv, "prefs.json"), JSON.stringify({ startNotice: true }));
  const future = new Date(Date.now() + 3 * 3_600_000);
  utimesSync(statePath(p), future, future);
  assert.doesNotMatch(stateAgeNotice(p, new Date()), /-\d/);
  // DST or a manual change: the real hook, run as its own entry point, with the whole clock moved years ahead
  const T = Date.parse("2031-03-30T02:30:00+02:00");
  const jump = `data:text/javascript,${encodeURIComponent(`const R = Date, T = ${T}; globalThis.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } };`)}`;
  say(t, "c3", 40, "Third: never skip the changelog.");
  const r = hook("claude.stop", { session_id: "c", transcript_path: t, cwd: p.root, last_assistant_message: "Changelog kept." }, ["--import", jump]);
  assert.equal(r.status, 0);
  const packet = readFileSync(statePath(p), "utf8");
  assert.match(packet, /updated 2031-03-30T00:30/, "the hook really ran under the jumped clock");
  assert.match(packet, /Changelog kept\./);
  assert.equal(readMissionRecord(p, "c")?.mission.pins.length, 3, "the contract still adds the new rule, none lost");
});

test("a usage limit or an API error never becomes the goal, the reply, a rule or a Timeline result", () => {
  const p = tmpRepo();
  const t = join(p.root, "t.jsonl");
  say(t, "u1", 0, "Migrate the database to Postgres. Never drop the users table.");
  hook("claude.stop", { session_id: "s", transcript_path: t, cwd: p.root, last_assistant_message: "Migrated the schema. Next: move the data." });
  say(t, "u2", 5, "now move the data");
  const notice = "You've hit your 5-hour limit · resets 12am (Asia/Calcutta)";
  appendFileSync(t, JSON.stringify({ type: "assistant", uuid: "lim", timestamp: ts(6), isApiErrorMessage: true, message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: notice }], usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + "\n");
  assert.equal(hook("claude.stopfailure", { session_id: "s", transcript_path: t, cwd: p.root, error: "rate_limit", last_assistant_message: notice }).status, 0);
  // the next Stop after the reset delivers the same notice as the "reply": still not a reply
  assert.equal(hook("claude.stop", { session_id: "s", transcript_path: t, cwd: p.root, last_assistant_message: notice }).status, 0);
  const packet = readFileSync(statePath(p), "utf8");
  assert.match(packet, /HANDOFF READY|## Goal\n/);
  assert.match(packet, /\*\*North star:\*\* Migrate the database to Postgres/);
  assert.match(packet, /“Never drop the users table\.”/);
  const goal = /## Goal\n([^\n]*)/.exec(packet)?.[1] ?? "";
  assert.doesNotMatch(goal, /limit/);
  assert.doesNotMatch(/## Where we left off[\s\S]*/.exec(packet)?.[0] ?? "", /### Assistant\nYou've hit your/);
  const eps = readFileSync(join(p.priv, "episodes.jsonl"), "utf8");
  assert.doesNotMatch(eps, /"done":"You've hit/);
  assert.ok(existsSync(join(p.states, "s.mission.json")));
});

test("transcripts deleted by Claude Code's cleanup (cleanupPeriodDays): handoff, status, Quick check and titles carry on", () => {
  const p = tmpRepo();
  const dir = claudeProjectDir(p.root);
  mkdirSync(dir, { recursive: true });
  const t = join(dir, "old-chat.jsonl");
  say(t, "o1", 0, "Build the invoice parser. Never round amounts.");
  appendFileSync(t, JSON.stringify({ type: "custom-title", customTitle: "Invoice parser", sessionId: "old-chat" }) + "\n");
  assert.equal(hook("claude.stop", { session_id: "old-chat", transcript_path: t, cwd: p.root, last_assistant_message: "Parser built." }).status, 0);
  rmSync(t); // the cleanup removes the file; Cortex's cursor, journal and packet still name it
  const n = join(dir, "new-chat.jsonl");
  say(n, "n1", 60, "/cortex-resume");
  appendFileSync(n, JSON.stringify({ type: "user", uuid: "n1r", timestamp: ts(61), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "r", content: readFileSync(statePath(p), "utf8") }] } }) + "\n");
  assert.equal(hook("claude.stop", { session_id: "new-chat", transcript_path: n, cwd: p.root, last_assistant_message: "Picking up the parser." }).status, 0);
  assert.ok(readMissionRecord(p, "new-chat")?.mission.pins.some((x) => x.text === "Never round amounts."), "the contract carried without the old transcript");
  // the old chat's stop again (a resumed window whose file is gone): nothing breaks
  assert.equal(hook("claude.stop", { session_id: "old-chat", transcript_path: t, cwd: p.root, last_assistant_message: "x" }).status, 0);
  const st = spawnSync(process.execPath, [join(ROOT, "claude-plugin", "cortex", "src", "status.mjs")], { cwd: p.root, encoding: "utf8" });
  assert.equal(st.status, 0, st.stderr);
  assert.equal((JSON.parse(st.stdout) as { root: string }).root.length > 0, true);
  const q = spawnSync(process.execPath, [CLI, "dream", "quick"], { cwd: p.root, encoding: "utf8" });
  assert.equal(q.status, 0, q.stderr);
});

