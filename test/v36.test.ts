import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import "./helpers.ts";
import { cortexFootprint } from "../src/core/plugin.ts";
import { installSkills, refreshOwnSkills } from "../src/skills.ts";

const claude = () => process.env.CORTEX_CLAUDE_HOME!;
const opencode = () => process.env.CORTEX_OPENCODE_HOME!;
const put = (dir: string, name: string, body: string) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, "SKILL.md"), body); };
const listPlugin = (on: boolean) => {
  mkdirSync(join(claude(), "plugins"), { recursive: true });
  writeFileSync(join(claude(), "plugins", "installed_plugins.json"), JSON.stringify({ plugins: on ? { "kapex-cortex@kapex-cortex": [] } : {} }));
};
const recordInstall = () => { mkdirSync(process.env.CORTEX_HOME!, { recursive: true }); writeFileSync(join(process.env.CORTEX_HOME!, "config.json"), JSON.stringify({ install: { node: "/usr/bin/node", cli: "/opt/cortex/src/cli.ts" } })); };

test("v3.6 with the plugin installed, Cortex's old copies leave ~/.claude/skills (no skill listed twice) and OpenCode gets its own", () => {
  rmSync(join(claude(), "skills"), { recursive: true, force: true });
  listPlugin(true);
  recordInstall();
  const skills = join(claude(), "skills");
  put(skills, "cortex-resume", "---\nname: cortex-resume\ndescription: Kapex Cortex resume\n---\nold steps\n");
  put(skills, "cortex-handoff", "---\nname: cortex-handoff\ndescription: Record a handoff (Kapex Cortex).\n---\n");
  put(skills, "cortex-init", "---\nname: cortex-init\n---\nmy own skill, not Cortex's\n");
  const changed = refreshOwnSkills();
  assert.equal(existsSync(join(skills, "cortex-resume")), false, "duplicate removed");
  assert.equal(existsSync(join(skills, "cortex-handoff")), false, "duplicate removed");
  assert.match(readFileSync(join(skills, "cortex-init", "SKILL.md"), "utf8"), /my own skill/, "a file Cortex didn't write is left alone");
  assert.match(readFileSync(join(opencode(), "skills", "cortex-resume", "SKILL.md"), "utf8"), /Pinned for this session/, "OpenCode keeps /cortex-resume, in its own folder");
  assert.ok(changed.length >= 2);
  assert.deepEqual(refreshOwnSkills().filter(f => f.startsWith(skills)), [], "nothing left to do the second time");
});

test("v3.6 installSkills writes ~/.claude/skills only without the plugin; with it, only OpenCode's copy (or nothing)", () => {
  const home = mkdtempSync(join(tmpdir(), "cortex-home-"));
  assert.ok(installSkills(home, "/usr/bin/node", "/x/cli.ts").every(f => f.startsWith(join(home, ".claude", "skills"))));
  assert.deepEqual(installSkills(home, "/usr/bin/node", "/x/cli.ts", { plugin: true }), [], "plugin, no OpenCode: nothing to write");
  process.env.CORTEX_OPENCODE_HOME = mkdtempSync(join(tmpdir(), "cortex-oc-")); // fresh: earlier tests wrote here
  const oc = installSkills(home, "/usr/bin/node", "/x/cli.ts", { plugin: true, opencode: true });
  assert.ok(oc.length === 3 && oc.every(f => f.startsWith(join(opencode(), "skills"))));
});

test("v3.6 the panel's 'Cortex adds to each message' is measured from the skill descriptions, duplicates counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "cortex-skills-"));
  const user = mkdtempSync(join(tmpdir(), "cortex-user-skills-"));
  for (const n of ["cortex-handoff", "cortex-init", "cortex-resume"]) put(dir, n, `---\nname: ${n}\ndescription: ${"x".repeat(210)}\n---\nbody\n`);
  const one = cortexFootprint(dir, user);
  assert.equal(one.skills, 3);
  assert.equal(one.duplicates, 0);
  assert.ok(one.tokens > 200 && one.tokens < 320, `about 250 tokens, like claude plugin details (got ${one.tokens})`);
  put(user, "cortex-resume", `---\nname: cortex-resume\ndescription: ${"x".repeat(210)}\n---\n`);
  const two = cortexFootprint(dir, user);
  assert.equal(two.duplicates, 1);
  assert.ok(two.tokens > one.tokens);
});
