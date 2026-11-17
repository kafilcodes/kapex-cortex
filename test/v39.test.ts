import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutLeadIn } from "../src/core/brief.ts";
import { observe } from "../src/core/episodes.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectSpend } from "../src/core/spend.ts";

// v3.9: a message that only carries on with the work ("Continue", "The 5-hour limit has reset") never becomes the
// handoff goal; one that says real work after its lead-in counts, without the lead-in.

test("v3.9 continuation lead-ins are not a goal; the work said after them is", () => {
  for (const t of ["Continue", "Continue : The 5-hour limit has reset.", "The 5-hour limit has reset", "ok continue", "Hey , continue (we are continuing after a 1 day break) now continue, have full context"]) {
    assert.equal(withoutLeadIn(t), "", t);
  }
  assert.equal(withoutLeadIn("Read `.vault/STATE.md` and git status first so you have full context. Add a heatmap to Costs."), "Add a heatmap to Costs.");
  assert.equal(withoutLeadIn("Continue: the limit reset. Now add CSV export to the reports page"), "Now add CSV export to the reports page");
  assert.equal(withoutLeadIn("Add CSV export to the reports page"), "Add CSV export to the reports page");
  // a lead-in followed by real words is the task itself, kept whole (a fresh reviewer's cases)
  for (const t of ["Continue building the CSV export for the billing dashboard and add tests", "Proceed with deleting the old API routes", "Resume work on the payment webhook retry logic", "Resume the parser work: add CSV export"]) assert.equal(withoutLeadIn(t), t, t);
  assert.equal(withoutLeadIn("Read .vault/STATE.md first, then fix the failing login test"), "fix the failing login test");
  assert.equal(withoutLeadIn("we are continuing from last chat, cause of cold cache and now we are gonna improve the strip"), "we are gonna improve the strip");
  assert.equal(withoutLeadIn("Resume from the Kapex Cortex handoff: read .vault/STATE.md and continue from where we left off."), "");
});

test("v3.9 a turn's ask keeps your words: attached paths don't use up its room, and words after a leading command count", () => {
  const ep = { session: "s", start: "", end: "", ask: "", tools: {}, files: [], commands: [], tests: { ran: 0, failed: 0 }, commits: 0, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 0, contextTokens: 0, pending: {} };
  const long = `@"/Users/me/Downloads/${"x".repeat(180)}.md" @"/Users/me/Downloads/shot.avif" /cortex-resume Read the state first. Then add a heatmap to Costs and fix the gauge.`;
  observe(ep as never, { type: "user", timestamp: "2026-11-16T10:00:00Z", message: { role: "user", content: long } });
  assert.equal(ep.ask, "Read the state first. Then add a heatmap to Costs and fix the gauge.");
});

test("v3.9 a command's argument alone is not an ask, and the ask never grows past its room", () => {
  const ep = { session: "s", start: "", end: "", ask: "", tools: {}, files: [], commands: [], tests: { ran: 0, failed: 0 }, commits: 0, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 0, contextTokens: 0, pending: {} };
  observe(ep as never, { type: "user", timestamp: "2026-11-16T10:00:00Z", message: { role: "user", content: "/model opus" } });
  assert.equal(ep.ask, "");
  for (let i = 0; i < 5; i++) observe(ep as never, { type: "user", timestamp: "2026-11-16T10:00:00Z", message: { role: "user", content: "x".repeat(300) } });
  assert.ok(ep.ask.length <= 420, `ask stays bounded (got ${ep.ask.length})`);
});

test("v4.0 a reply with an unreadable time is skipped: spend never throws and keeps only real days", () => {
  const home = mkdtempSync(join(tmpdir(), "cortex-spend-")), priv = mkdtempSync(join(tmpdir(), "cortex-priv-"));
  const root = "/Users/you/demo", dir = join(home, "projects", root.replace(/[^A-Za-z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  const line = (ts: string, id: string) => JSON.stringify({ type: "assistant", timestamp: ts, message: { id, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } });
  writeFileSync(join(dir, "a.jsonl"), [line("2026-11-15T10:00:00Z", "m1"), line("not a date", "m2"), line("2026-11-16T09:00:00Z", "m3")].join("\n"));
  const r = projectSpend({ root, priv } as never, new Date("2026-11-16T12:00:00Z"), home);
  assert.deepEqual(Object.keys(r.days).sort(), Object.keys(r.days).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort());
  assert.equal(Object.keys(r.days).length, 2);
  assert.equal(r.hours.flat().reduce((a, x) => a + x, 0), 2);
});
