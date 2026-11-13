import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { nextFromReply } from "../src/core/brief.ts";
import { carriedFrom } from "../src/core/carry.ts";
import { isCopy } from "../src/core/dream-checks.ts";
import { summary } from "../src/core/episodes.ts";
import { chatTitle } from "../src/core/history.ts";
import { chatLabel } from "../src/core/timeline.ts";
import { claudeUserText } from "../src/core/transcript.ts";
import { tmpRepo } from "./helpers.ts";

const user = (content: string) => ({ type: "user", message: { role: "user", content } });

test("v3.8.2 a slash command keeps what you wrote after it; /cortex-resume is kept; other commands stay chatter", () => {
  const withArgs = "<command-message>kapex-cortex:cortex-resume</command-message>\n<command-name>/kapex-cortex:cortex-resume</command-name>\n<command-args>Read STATE first, then finish the Timeline polish</command-args>";
  assert.equal(claudeUserText(user(withArgs)), "/kapex-cortex:cortex-resume Read STATE first, then finish the Timeline polish");
  assert.equal(claudeUserText(user("<command-message>kapex-cortex:cortex-resume</command-message>\n<command-name>/kapex-cortex:cortex-resume</command-name>")), "/kapex-cortex:cortex-resume");
  assert.equal(claudeUserText(user("<command-name>/model</command-name>\n<command-args>opus</command-args>")), null);
  assert.equal(claudeUserText(user("<local-command-stdout>Set model to Opus</local-command-stdout>")), null);
});

test("v3.8.2 a chat that starts with /cortex-resume continues the chat whose handoff was current; others start fresh", () => {
  const p = tmpRepo();
  mkdirSync(p.states, { recursive: true });
  writeFileSync(join(p.vault, "STATE.md"), "# STATE — demo · main · updated x · from claude-code · session chat-a\n");
  const turn = (session: string, text: string) => [{ id: "1", ts: "2026-11-13T10:00:00Z", harness: "claude-code", session, ref: "r", text, redacted: 0 }];
  assert.equal(carriedFrom(p, "chat-b", turn("chat-b", "/kapex-cortex:cortex-resume")), "chat-a");
  assert.equal(carriedFrom(p, "chat-c", turn("chat-c", "Fix the login bug in src/auth.ts please")), "");
  // decided once: a later handoff from another chat doesn't change what chat-b continues
  writeFileSync(join(p.vault, "STATE.md"), "# STATE — demo · main · updated x · from claude-code · session chat-z\n");
  assert.equal(carriedFrom(p, "chat-b", turn("chat-b", "/kapex-cortex:cortex-resume")), "chat-a");
});

test("v3.8.2 Dream copies: contained or 80% shared; parallel rules with a different verb are not copies", () => {
  assert.equal(isCopy("Money is integer cents, never floats.", "Money is integer cents, never floats, always."), true);
  assert.equal(isCopy("Use pnpm, not npm", "Always use pnpm instead of npm in this repository"), true);
  assert.equal(isCopy("Log parsers before merging.", "Prefer parsers before merging."), false);
  assert.equal(isCopy("Log currency tables once per release.", "Prefer currency tables once per release."), false);
});

test("v3.8.2 a turn's summary is its first real sentence; Next: is found mid-paragraph; filenames stay whole", () => {
  assert.equal(summary("Sure! Fixed the rounding bug in totals: src/totals.ts summed floats. Tests pass."), "Fixed the rounding bug in totals: src/totals.ts summed floats.");
  assert.equal(summary("| a | b |\n```\ncode.\n```\nLet me check. Updated the README with the totals example."), "Updated the README with the totals example.");
  assert.equal(nextFromReply("Docs pass 10 done. Next: add CSV export in src/export.ts with a test."), "add CSV export in src/export.ts with a test.");
  assert.equal(nextFromReply("Next step: ship it"), "ship it");
});

test("v3.8.2 handoffs name their chat: the saved title, else the title in the transcript's tail; labels cut on a word", () => {
  const p = tmpRepo();
  mkdirSync(p.cursors, { recursive: true });
  const t = join(p.root, "t.jsonl");
  writeFileSync(t, `${JSON.stringify({ type: "user", message: { role: "user", content: "hi" } })}\n${JSON.stringify({ type: "custom-title", customTitle: "Invoice parser", sessionId: "s1" })}\n`);
  writeFileSync(join(p.cursors, "claude-s1.json"), JSON.stringify({ path: t, offset: 0 }));
  assert.equal(chatTitle(p, "s1"), "Invoice parser");
  writeFileSync(join(p.cursors, "claude-s2.json"), JSON.stringify({ title: "Saved title" }));
  assert.equal(chatTitle(p, "s2"), "Saved title");
  assert.equal(chatLabel("(pasted) Read the handoff and continue with the timeline polish please"), "Read the handoff and continue with the timeline…");
});

test("v3.8.2 a reply's 'Next:' sentence is never taken as what was done", () => {
  assert.equal(summary("Docs pass 10 done. Next: add CSV export in src/export.ts with a test."), "");
  assert.equal(summary("Okay. Wired the export button to the CSV writer. Next: tests."), "Wired the export button to the CSV writer.");
});
