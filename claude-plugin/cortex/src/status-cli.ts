#!/usr/bin/env node
// `kc status --json`, the panel's most frequent call (after every reply), as its own small entry point: the plugin runs
// it from one pre-built JavaScript file (cortex/src/status.mjs), so it skips Node's TypeScript stripping (~60 ms a
// call) and the rest of the CLI. Same output as `cli.ts status --json`, including the "not here" answer.
import { nearbyProjects, repoPaths, resolveProject } from "./core/paths.ts";
import { computeStatus } from "./core/status.ts";

export function statusJson(cwd = process.cwd()): { code: number; out: string } {
  const root = resolveProject(cwd);
  if (!root) return { code: 1, out: JSON.stringify({ off: true, cwd, nearby: nearbyProjects(cwd) }) };
  return { code: 0, out: JSON.stringify(computeStatus(repoPaths(root))) };
}

const r = statusJson();
process.stdout.write(r.out);
process.exitCode = r.code;
