import { rmSync } from "node:fs";
import { join } from "node:path";
import { dreaming, listDreams, runDream, type DreamReport } from "./dream.ts";
import { nativeFiles } from "./native.ts";
import type { RepoPaths } from "./paths.ts";
import { rememberCheck } from "./quick.ts";
import { gitInfo } from "./state.ts";

/**
 * The Quick check the Stop hook starts in the background when a memory file or the code changed: Cortex's own checks
 * (no model, no tokens), saved as a checks-only Dream so its findings get the same Apply / Keep / Undo buttons.
 * It never replaces a Dream you're in the middle of (a model's findings waiting, or some already decided), and a
 * checks-only Dream that found exactly what the previous one did replaces it quietly instead of piling up.
 */
const keys = (r: DreamReport) => r.findings.map((f) => `${f.kind}|${f.label}|${f.line}|${f.entry}`).sort().join("\n");
export const treeOf = (gi: { branch: string; diffStat: string } | null) => `${gi?.branch ?? ""}|${gi?.diffStat ?? ""}`;

export async function quickCheck(p: RepoPaths): Promise<string> {
  const files = nativeFiles(p.root).map((f) => f.path);
  const tree = treeOf(gitInfo(p.root, "quick", false));
  const latest = listDreams(p, 1)[0];
  const open = latest && (latest.status === "proposed" || latest.status === "applied") ? latest.findings.filter((f) => !f.done) : [];
  const waiting = open.some((f) => f.by === "model") || (open.length > 0 && !!latest?.findings.some((f) => f.done));
  if (dreaming(p) || waiting) { rememberCheck(p, files, tree); return "A Dream is running or waiting for your decisions: left as it is."; }
  const r = await runDream(p, { model: false });
  if (latest && latest.status === "proposed" && !latest.model && !latest.findings.some((f) => f.done) && keys(latest) === keys(r)) {
    rmSync(join(p.vault, "dreams", latest.id), { recursive: true, force: true });
  }
  rememberCheck(p, files, tree);
  return `Quick check: ${r.findings.length ? `${r.findings.length} finding${r.findings.length === 1 ? "" : "s"} to look at` : "nothing to fix"}.`;
}
