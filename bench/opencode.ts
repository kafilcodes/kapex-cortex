// Drive OpenCode 2.x through its background server (the same API OpenCode.app uses).
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROBE_DOCKER, PROBE_MEMORY, SCRIPT, type Fixture } from "./scenario.ts";

const OC = process.env.OPENCODE_BIN ?? join(homedir(), ".opencode", "bin", "opencode");

const OUT_DIR = mkdtempSync(join(tmpdir(), "decaybench-out-"));
let outN = 0;

/**
 * Run the opencode CLI with stdout going to a FILE, not a pipe: on large outputs (≈400 KB+) the CLI exits
 * before a piped stdout is fully flushed, which truncated the JSON (the "Unterminated string" crash).
 * Retries a parse failure up to 3 times.
 */
function ocRaw(cwd: string, args: string[], timeoutMs = 600_000): string {
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = join(OUT_DIR, `out-${++outN}.json`);
    const fd = openSync(file, "w");
    try { spawnSync(OC, args, { cwd, stdio: ["ignore", fd, "ignore"], timeout: timeoutMs }); } finally { closeSync(fd); }
    const text = readFileSync(file, "utf8");
    if (!text.trim()) return "";
    try { JSON.parse(text); return text; } catch { /* truncated: try again */ }
  }
  throw new Error(`opencode ${args.slice(0, 3).join(" ")}: output was not valid JSON after 3 tries`);
}

function api(cwd: string, method: string, path: string, body?: unknown, timeoutMs = 600_000): any {
  const text = ocRaw(cwd, ["api", method, path, ...(body !== undefined ? ["--data", JSON.stringify(body)] : [])], timeoutMs);
  return text ? JSON.parse(text) : {};
}

const exportSession = (cwd: string, sid: string): any => { const t = ocRaw(cwd, ["session", "export", sid]); return t ? JSON.parse(t) : {}; };

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function textOf(messages: any[]): string {
  const out: string[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== "object") return;
    if (typeof o.text === "string") out.push(o.text);
    if (typeof o.output === "string") out.push(o.output);
    if (typeof o.summary === "string") out.push(o.summary); // OpenCode 2 compaction summary
    if (typeof o.recent === "string") out.push(o.recent);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  walk(messages);
  return out.join("\n");
}

function lastAssistantText(cwd: string, sid: string): string {
  const d = exportSession(cwd, sid);
  const msgs = (d.messages ?? []).filter((m: any) => m.type === "assistant");
  const last = msgs.at(-1);
  return (last?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
}

/**
 * Wait until the latest user turn has an idle marker after it. Any permission request is answered
 * "reject" automatically (never approve) and recorded, so a model trying to run e.g. docker is counted.
 */
function waitIdle(cwd: string, sid: string, asked: string[] = [], maxMs = 600_000): void {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    sleep(3_000);
    const pend = api(cwd, "GET", `/api/session/${sid}/permission`);
    for (const req of Array.isArray(pend?.data) ? pend.data : []) {
      asked.push(`${req.action}: ${(req.resources ?? []).join(" | ")}`);
      api(cwd, "POST", `/api/session/${sid}/permission/${req.id}/reply`, { decision: "reject", message: "Not allowed in this benchmark." });
    }
    let msgs: any[] = [];
    try { msgs = exportSession(cwd, sid).messages ?? []; } catch { continue; }
    const lastUser = msgs.map((m) => m.type).lastIndexOf("user");
    const tail = msgs.slice(lastUser + 1);
    if (lastUser >= 0 && tail.some((m) => m.type === "idle")) return;
  }
  throw new Error("timed out waiting for the model");
}

/** Tool calls (non-text parts) the model made since the latest user message. */
function toolCallsSinceLastUser(cwd: string, sid: string): string {
  const msgs: any[] = exportSession(cwd, sid).messages ?? [];
  const lastUser = msgs.map((m) => m.type).lastIndexOf("user");
  return msgs
    .slice(lastUser + 1)
    .filter((m) => m.type === "assistant")
    .flatMap((m) => (m.content ?? []).filter((c: any) => c.type !== "text" && c.type !== "reasoning"))
    .map((c: any) => JSON.stringify(c))
    .join("\n");
}

function compactionId(cwd: string, sid: string): string {
  const msgs = (api(cwd, "GET", `/api/session/${sid}/context`)?.data ?? []) as any[];
  return msgs.find((m) => m?.type === "compaction")?.id ?? "";
}

/** Trigger a real OpenCode compaction and wait until a NEW compaction marker has an idle after it. */
function compact(cwd: string, sid: string, maxMs = 600_000): void {
  const before = compactionId(cwd, sid);
  api(cwd, "POST", `/api/session/${sid}/compact`, {});
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    sleep(4_000);
    const msgs = (api(cwd, "GET", `/api/session/${sid}/context`)?.data ?? []) as any[];
    const i = msgs.findIndex((m) => m?.type === "compaction");
    if (i >= 0 && msgs[i].id !== before && msgs.slice(i + 1).some((m) => m?.type === "idle")) return;
  }
  throw new Error("compaction did not finish");
}

export interface OcRun {
  memoryReply: string;
  docker: { attempted: boolean; reply: string; asked: string[] };
  contextText: string;
  instructionText: string;
  sessionID: string;
  seconds: number;
}

export function runOpenCode(fx: Fixture, model: { providerID: string; id: string }): OcRun {
  const t0 = Date.now();
  const s = api(fx.root, "POST", "/api/session", { title: `decaybench-${fx.cortex ? "cortex" : "vanilla"}`, model, location: { directory: fx.root } });
  const sid: string = s?.data?.id;
  if (!sid) throw new Error(`session create failed: ${JSON.stringify(s).slice(0, 200)}`);
  for (const step of SCRIPT) {
    if (step.kind === "compact") { compact(fx.root, sid); sleep(4_000); continue; } // let Cortex re-attach entries
    api(fx.root, "POST", `/api/session/${sid}/prompt`, { text: step.text });
    waitIdle(fx.root, sid);
  }
  const ctx = api(fx.root, "GET", `/api/session/${sid}/context`);
  const ins = api(fx.root, "GET", `/api/experimental/session/${sid}/instructions/entries`);
  api(fx.root, "POST", `/api/session/${sid}/prompt`, { text: PROBE_MEMORY });
  waitIdle(fx.root, sid);
  const memoryReply = lastAssistantText(fx.root, sid);
  const asked: string[] = [];
  api(fx.root, "POST", `/api/session/${sid}/prompt`, { text: PROBE_DOCKER });
  waitIdle(fx.root, sid, asked);
  const calls = toolCallsSinceLastUser(fx.root, sid);
  const attempted = asked.some((a) => /docker/i.test(a)) || /docker\s+ps/i.test(calls);
  return {
    memoryReply,
    docker: { attempted, reply: lastAssistantText(fx.root, sid), asked },
    contextText: textOf(ctx?.data ?? ctx),
    instructionText: textOf(ins?.data ?? ins) + "\n" + JSON.stringify(ins?.data ?? ins),
    sessionID: sid,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

/** Generic runner (bench v3): the given steps, then each probe; returns the assistant's reply to each probe. */
export function runSteps(fx: Fixture, model: { providerID: string; id: string }, steps: ({ kind: "prompt"; text: string } | { kind: "compact" })[], probes: string[], freshSession = false) {
  const t0 = Date.now();
  const s = api(fx.root, "POST", "/api/session", { title: `decaybench3-${fx.cortex ? "cortex" : "vanilla"}`, model, location: { directory: fx.root } });
  const sid: string = s?.data?.id;
  if (!sid) throw new Error(`session create failed: ${JSON.stringify(s).slice(0, 200)}`);
  for (const step of steps) {
    if (step.kind === "compact") { compact(fx.root, sid); sleep(4_000); continue; }
    api(fx.root, "POST", `/api/session/${sid}/prompt`, { text: step.text });
    waitIdle(fx.root, sid);
  }
  // freshSession: ask in a NEW chat in the same project (the next day / after a usage limit), which has no history
  let qid = sid;
  if (freshSession) {
    sleep(4_000); // let Cortex's hooks finish writing the handoff
    const n = api(fx.root, "POST", "/api/session", { title: `decaybench3-next-${fx.cortex ? "cortex" : "vanilla"}`, model, location: { directory: fx.root } });
    qid = n?.data?.id;
    if (!qid) throw new Error(`second session create failed: ${JSON.stringify(n).slice(0, 200)}`);
  }
  const ins = api(fx.root, "GET", `/api/experimental/session/${qid}/instructions/entries`);
  const replies: string[] = [];
  for (const probe of probes) {
    api(fx.root, "POST", `/api/session/${qid}/prompt`, { text: probe });
    waitIdle(fx.root, qid);
    replies.push(lastAssistantText(fx.root, qid));
  }
  return { replies, instructionText: textOf(ins?.data ?? ins), sessionID: sid, seconds: Math.round((Date.now() - t0) / 1000) };
}
