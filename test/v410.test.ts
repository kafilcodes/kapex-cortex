import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { tmpRepo } from "./helpers.ts";
import { judge } from "../src/core/backends.ts";
import { forgetPrefs, parsePref, readPrefs } from "../src/core/prefs.ts";
import { opencodeInfo, parseVersion } from "../src/core/opencode.ts";
import { opencodeCommands } from "../src/init.ts";
import { cortexHome } from "../src/core/home.ts";

const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
const writePrefs = (prefs: Record<string, unknown>) => { mkdirSync(cortexHome(), { recursive: true }); writeFileSync(join(cortexHome(), "config.json"), JSON.stringify({ prefs })); forgetPrefs(); };

test("v4.10 prefs: OpenCode no longer judges; an old own-key setup keeps its model in dreamApiModel; Claude's model stays Claude's", () => {
  writePrefs({ dreamBackend: "opencode", dreamModel: "opencode/deepseek-v4.1-flash-free" });
  let pr = readPrefs();
  assert.equal(pr.dreamBackend, "claude");
  assert.equal(pr.dreamModel, "sonnet");
  writePrefs({ dreamBackend: "api", dreamApi: "openai", dreamModel: "nvidia/nemotron-3-ultra" });
  pr = readPrefs();
  assert.deepEqual([pr.dreamBackend, pr.dreamModel, pr.dreamApiModel, pr.dreamEffort], ["api", "sonnet", "nvidia/nemotron-3-ultra", "medium"]);
  writePrefs({ dreamBackend: "api", dreamModel: "haiku", dreamApiModel: "x/y", dreamEffort: "high" });
  pr = readPrefs();
  assert.deepEqual([pr.dreamModel, pr.dreamApiModel, pr.dreamEffort], ["haiku", "x/y", "high"]);
  assert.equal(typeof parsePref("dreamModel", "nvidia/x"), "string", "dreamModel takes only Claude's models");
  assert.deepEqual(parsePref("dreamModel", "Opus"), { key: "dreamModel", value: "opus" });
  assert.deepEqual(parsePref("dreamEffort", "low"), { key: "dreamEffort", value: "low" });
  assert.equal(typeof parsePref("dreamBackend", "opencode"), "string");
  writePrefs({});
});

test("v4.10 judge: your own key first; on any failure Claude on your plan answers and the fallback says what failed", async () => {
  const base = { dreamBackend: "api", dreamModel: "haiku", dreamEffort: "low" as const, dreamApiModel: "x/y", dreamApi: "openai" as const, dreamUrl: "" };
  const prev = process.env.CORTEX_TEST_MODEL_ANSWER;
  try {
    // the test hook answers every call the same way, so: a key call that "fails" has to fail before the model step,
    // which an empty endpoint does (checked before the call); the hook then answers the Claude fallback
    process.env.CORTEX_TEST_MODEL_ANSWER = '{"ok": true}';
    const r = await judge({ ...base, dreamUrl: "" }, "s", "m", { type: "object" });
    assert.equal(r.raw, '{"ok": true}');
    // with the canned answer the key's call itself "succeeds" (the hook runs first): no fallback recorded
    assert.equal(r.by, "api · x/y");
    const c = await judge({ ...base, dreamBackend: "claude" }, "s", "m", undefined);
    assert.equal(c.by, "claude · haiku");
    // the key's model answers without the JSON a Dream needs: Claude answers instead, and the fallback says why
    process.env.CORTEX_TEST_MODEL_ANSWER = "sorry, I can't";
    const f = await judge(base, "s", "m", { type: "object" });
    assert.equal(f.by, "claude · haiku");
    assert.deepEqual(f.fallback, { from: "api · x/y", why: "its answer had no JSON in it" });
    process.env.CORTEX_TEST_MODEL_ANSWER = "ERROR the provider said no";
    await assert.rejects(judge(base, "s", "m", undefined), /your own key's model failed \(the provider said no\), and Claude on your plan failed too/);
  } finally {
    if (prev === undefined) delete process.env.CORTEX_TEST_MODEL_ANSWER; else process.env.CORTEX_TEST_MODEL_ANSWER = prev;
  }
});

test("v4.10 OpenCode: version parsing, the project's set-up state, and a /cortex-resume that handles a missing or old packet", () => {
  assert.equal(parseVersion("opencode v2.2.5"), "2.2.5");
  assert.equal(parseVersion("1.14"), "1.14");
  assert.equal(parseVersion("unknown"), null);
  const root = mkdtempSync(join(tmpdir(), "cortex-oc-"));
  assert.deepEqual([opencodeInfo(root).plugin, opencodeInfo(root).command], [false, false]);
  mkdirSync(join(root, ".opencode", "command"), { recursive: true });
  writeFileSync(join(root, ".opencode", "command", "cortex-resume.md"), "x"); // OpenCode 1.x's folder counts too
  assert.equal(opencodeInfo(root).command, true);
  const body = opencodeCommands({ node: "node", cli: "cli" } as never)["cortex-resume"]!;
  const sh = /!`([^`]+)`/.exec(body)![1]!;
  // run the include as OpenCode would, in the project folder: no packet, then a packet with its age
  let r = spawnSync("sh", ["-c", sh], { cwd: root, encoding: "utf8" });
  assert.match(r.stdout, /^NO_HANDOFF/);
  mkdirSync(join(root, ".vault"), { recursive: true });
  writeFileSync(join(root, ".vault", "STATE.md"), "# STATE — demo\n## Goal\nship it\n");
  r = spawnSync("sh", ["-c", sh], { cwd: root, encoding: "utf8" });
  assert.match(r.stdout, /^\(packet saved \d+ minutes ago\)\n# STATE — demo/);
  assert.match(body, /NO_HANDOFF: tell the user/);
  assert.match(body, /OpenCode 1\.x, run \/cortex-handoff/);
});
