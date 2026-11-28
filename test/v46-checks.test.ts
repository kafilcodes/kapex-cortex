import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { entries, nativeFiles } from "../src/core/native.ts";
import { mechanicalChecks } from "../src/core/dream-checks.ts";
import { guardChecks } from "../src/core/dream-model.ts";

// 2026-11-27, Kafil's own repo: a quick check run from a worktree called a hard-limit rule stale ("`.vault/private/
// errors.log` no longer exists": it is made on the first error, in the main checkout's vault) and a memory note naming
// `.claude/worktrees/v46-stageshow-ui` stale (it exists, from the main checkout). Both were offered for deletion.
test("memory check from a worktree: a runtime file or a path from the main checkout is not stale; a gone source file still is", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "cortex-test-wtcheck-")));
  const main = join(home, "proj"), wt = join(main, ".claude", "worktrees", "wt");
  mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
  mkdirSync(join(main, ".vault", "private"), { recursive: true }); // the vault: in the main checkout only
  writeFileSync(join(main, ".vault", "cortex.json"), "{}");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
  const md = [
    "# Project", "", "## Hard limits",
    "- Hooks never break the harness: always exit 0 and log errors to `.vault/private/errors.log`.",
    "- Logs of the last run sit in `out/run.log` when there is one.",
    "", "## Notes",
    "- The v4.6 work lives in `.claude/worktrees/wt` until it merges.",
    "- The parser lives in `src/parser.ts`.",
  ].join("\n") + "\n";
  writeFileSync(join(wt, "CLAUDE.md"), md);
  const was = process.env.HOME, wasProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
  try {
    const files = nativeFiles(wt);
    const ents = files.filter((f) => !f.twin).flatMap((f) => entries(f.path, f.label, readFileSync(f.path, "utf8")));
    const found = guardChecks(mechanicalChecks(wt, files, ents, []), ents, []);
    const stale = found.filter((f) => f.kind === "stale");
    assert.deepEqual(stale.filter((f) => /errors\.log|run\.log|worktrees/.test(f.entry)).map((f) => f.entry), [], "runtime files and main-checkout paths are not stale");
    const parser = stale.find((f) => /src\/parser\.ts/.test(f.entry));
    assert.ok(parser, "a source file that is gone everywhere is still found");
    assert.equal(parser!.action.op, "delete");
  } finally {
    if (was === undefined) delete process.env.HOME; else process.env.HOME = was;
    if (wasProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = wasProfile;
  }
});

test("the load-bearing guard holds a rule whose 'never' is mid-sentence under a Hard limits heading", () => {
  const ent = { file: "/x/CLAUDE.md", label: "CLAUDE.md", line: 4, end: 4, heading: "Hard limits", text: "- Hooks never break the harness: always exit 0 and log errors to `x.log`." } as never;
  const out = guardChecks([{ kind: "stale", file: "/x/CLAUDE.md", line: 4, why: "gone", action: { op: "delete" } }], [ent], []);
  assert.equal(out[0]!.action.op, "none");
  assert.match(out[0]!.why, /^Load-bearing/);
});
