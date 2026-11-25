import assert from "node:assert/strict";
import { test } from "node:test";
import { answerText, apiBase, callHttpModel, httpReason, retryWait, type HttpModel } from "../src/core/api-call.ts";
import { normConf, normId } from "../src/core/dream-model.ts";

// v4.8: a Dream judged by any OpenAI-compatible provider (OpenRouter, NVIDIA NIM, Groq, a local server) survives what
// real providers do. Every case below was seen live with NVIDIA NIM on 2026-11-18, or is documented provider behaviour.

const M: HttpModel = { api: "openai", url: "https://example.test/v1", model: "acme/model", key: "sk-secret-key" };
type R = { status: number; body: unknown; headers?: Record<string, string> };
/** A fake network: answers in order, records what was sent. */
function net(...replies: (R | Error)[]) {
  const sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    sent.push({ url, body: JSON.parse(init.body) as Record<string, unknown>, headers: init.headers });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text, headers: new Headers(r.headers ?? {}) };
  }) as unknown as typeof fetch;
  const waits: number[] = [];
  return { sent, waits, o: { timeoutMs: 60_000, maxTokens: 800, fetchImpl, sleep: async (ms: number) => { waits.push(ms); } } };
}
const ok = (content: unknown, finish = "stop") => ({ status: 200, body: { choices: [{ message: { content }, finish_reason: finish }] } });

test("api: a plain answer, sent to the base URL even when /chat/completions was pasted with it", async () => {
  const n = net(ok('{"ok": true}'));
  assert.equal(await callHttpModel({ ...M, url: "https://example.test/v1/chat/completions/" }, "sys", "msg", n.o), '{"ok": true}');
  assert.equal(n.sent[0]!.url, "https://example.test/v1/chat/completions");
  assert.equal(apiBase("https://integrate.api.nvidia.com/v1/"), "https://integrate.api.nvidia.com/v1");
});

test("api: 429 waits as Retry-After says, 503 waits 2 s then 6 s, then the answer comes", async () => {
  const n = net({ status: 429, body: { error: { message: "slow down" } }, headers: { "retry-after": "3" } }, { status: 503, body: "<html>busy</html>" }, ok("fine"));
  assert.equal(await callHttpModel(M, "s", "m", n.o), "fine");
  assert.deepEqual(n.waits, [3_000, 6_000]);
  assert.equal(retryWait(1, null), 2_000);
  assert.equal(retryWait(1, "999"), 20_000, "never waits more than 20 s");
});

test("api: a refused key, a wrong model and no credits each say what to fix; the key never shows", async () => {
  for (const [status, words] of [[401, "API key was refused"], [403, "API key was refused"], [404, 'no model "acme/model"'], [402, "out of credits"]] as const) {
    const n = net({ status, body: { error: { message: "nope" } } });
    await assert.rejects(callHttpModel(M, "s", "m", n.o), (e: Error) => e.message.includes(words) && !e.message.includes("sk-secret-key"));
    assert.equal(n.sent.length, 1, `${status} is not retried`);
  }
});

test("api: an error page that isn't JSON gives its status and words, not a parse error", async () => {
  assert.match(httpReason(502, "<html><body>Bad gateway</body></html>", "m"), /^502: the provider had a problem on its side \(Bad gateway\)$/);
  const n = net({ status: 200, body: "<html>maintenance</html>" });
  await assert.rejects(callHttpModel(M, "s", "m", n.o), /isn't JSON \(<html>maintenance<\/html>\)/);
});

test("api: a thinking model out of room gets one more try with three times the room, then a plain reason", async () => {
  const empty = { status: 200, body: { choices: [{ message: { content: null, reasoning_content: "hmm…" }, finish_reason: "length" }] } };
  const n = net(empty, ok('{"ok": true}'));
  assert.equal(await callHttpModel(M, "s", "m", n.o), '{"ok": true}');
  assert.equal(n.sent[1]!.body.max_tokens, 2_400);
  const n2 = net(empty, empty);
  await assert.rejects(callHttpModel(M, "s", "m", n2.o), /spent its whole answer thinking/);
});

test("api: <think> blocks and lists of parts become plain text; JSON mode is dropped when the provider refuses it", async () => {
  assert.equal(answerText("<think>let me see {x}</think>\n{\"ok\": true}"), '{"ok": true}');
  assert.equal(answerText([{ type: "text", text: '{"a":' }, { type: "text", text: "1}" }]), '{"a":1}');
  const n = net({ status: 400, body: { error: { message: "response_format is not supported" } } }, ok("{}"));
  assert.equal(await callHttpModel(M, "s", "m", { ...n.o, json: true }), "{}");
  assert.ok(n.sent[0]!.body.response_format && !n.sent[1]!.body.response_format);
});

test("api: a dropped connection is retried; one that keeps dropping gives a plain reason", async () => {
  const n = net(new Error("socket hang up"), ok("back"));
  assert.equal(await callHttpModel(M, "s", "m", n.o), "back");
  const n2 = net(new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET"));
  await assert.rejects(callHttpModel(M, "s", "m", n2.o), /could not reach the endpoint/);
});

test("dream: ids and confidence as other models write them are understood", () => {
  for (const x of ["E5", "e5", "E 5", "#5", "[E5]", 5, "5", "E-5"]) assert.equal(normId(x, "E"), "E5", String(x));
  assert.equal(normId("N5", "E"), "", "a note id is not evidence");
  assert.equal(normId("E5x", "E"), "");
  assert.equal(normConf("0.8"), 0.8);
  assert.equal(normConf(85), 0.85);
  assert.equal(normConf("high"), 0);
});

test("dream: in a git worktree inside the main checkout, the main copy of CLAUDE.md is the same file, never a duplicate", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, realpathSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { nativeFiles, mainCheckout, entries } = await import("../src/core/native.ts");
  const { mechanicalChecks } = await import("../src/core/dream-checks.ts");
  // a home with the main checkout in it and a worktree under main/.claude/worktrees/wt (Claude Desktop's layout)
  const home = realpathSync(mkdtempSync(join(tmpdir(), "cortex-test-wthome-")));
  const main = join(home, "proj"), wt = join(main, ".claude", "worktrees", "wt");
  mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
  const md = "# Project\n\n- Zero runtime dependencies: Node built-ins only, never a package.\n- Run the full check before every single commit please.\n";
  writeFileSync(join(main, "CLAUDE.md"), md);
  writeFileSync(join(wt, "CLAUDE.md"), md);
  assert.equal(mainCheckout(wt), main);
  assert.equal(mainCheckout(main), null, "a plain checkout has a .git folder");
  const was = process.env.HOME;
  process.env.HOME = home;
  try {
    const files = nativeFiles(wt);
    const twin = files.find((f) => f.path === join(main, "CLAUDE.md"));
    assert.ok(twin?.twin, "the main copy is still listed (Claude Code loads it, so it costs tokens) and marked as the twin");
    const { readFileSync } = await import("node:fs");
    const ents = files.flatMap((f) => entries(f.path, f.label, readFileSync(f.path, "utf8")));
    const dupes = mechanicalChecks(wt, files, ents, []).filter((f) => f.kind === "duplicate");
    assert.deepEqual(dupes, [], "no line of the branch's CLAUDE.md is a 'repeat' of its own main copy");
  } finally { process.env.HOME = was; }
});
