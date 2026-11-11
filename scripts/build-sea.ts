// Builds Cortex as one executable for this machine (Node single executable application), so people
// without Node can run it. Steps: bundle src/ into one ES module with esbuild (build-time only; the
// product still has zero runtime dependencies) → `node --build-sea` → ad-hoc codesign on macOS → smoke test.
// Usage: npm run build:sea   → dist/cortex-<platform>-<arch>[.exe]
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const win = process.platform === "win32";
const name = `cortex-${process.platform}-${process.arch}${win ? ".exe" : ""}`;
const out = join(DIST, name);

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout || r.error}`);
  return r.stdout;
}

mkdirSync(DIST, { recursive: true });
rmSync(out, { force: true });

// 1. one ES module; node: built-ins stay imports
const esbuild = join(ROOT, "node_modules", ".bin", win ? "esbuild.cmd" : "esbuild");
run(win ? "cmd" : esbuild, [...(win ? ["/c", esbuild] : []), "src/cli.ts", "--bundle", "--platform=node", "--format=esm", "--target=node24",
  "--outfile=dist/cortex.mjs", "--log-level=warning"], { cwd: ROOT });

// 2. the single executable, with the OpenCode plugin template embedded as an asset
const config = join(DIST, "sea-config.json");
writeFileSync(config, JSON.stringify({
  main: join(DIST, "cortex.mjs"),
  mainFormat: "module",
  output: out,
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  useSnapshot: false,
  assets: { "opencode-plugin.ts": join(ROOT, "templates", "opencode-plugin.ts") },
}, null, 2));
run(process.execPath, ["--build-sea", config], { cwd: ROOT });

// 3. macOS refuses unsigned edited binaries: ad-hoc sign (Windows runs unsigned binaries, with a SmartScreen prompt)
if (process.platform === "darwin") run("codesign", ["--sign", "-", "--force", out]);

// 4. smoke test in a throwaway project, with a throwaway Cortex home (never the real one)
const tmp = mkdtempSync(join(tmpdir(), "cortex-sea-"));
const env = { ...process.env, CORTEX_HOME: join(tmp, "home"), CORTEX_VAULT: "", CORTEX_NO_NOTIFY: "1" };
run(out, ["init", tmp], { env });
const status = JSON.parse(run(out, ["status", "--json"], { cwd: tmp, env })) as { project?: string };
if (!status.project) throw new Error("status --json returned no project");
const hook = spawnSync(out, ["hook", "claude.sessionstart", "--plugin"], { input: JSON.stringify({ session_id: "s", cwd: tmp }), encoding: "utf8", env });
if (hook.status !== 0) throw new Error(`hook failed: ${hook.stderr}`);
rmSync(tmp, { recursive: true, force: true });
console.log(`built ${name} (${Math.round(statSync(out).size / 1e6)} MB) · init, status and a hook ran from the binary`);
