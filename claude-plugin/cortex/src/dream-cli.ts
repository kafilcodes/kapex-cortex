import { applyDream, discardDream, dreaming, listDreams, readDream, runDream, skipFinding, undoDream, type DreamReport } from "./core/dream.ts";
import { spawnDream } from "./core/dream-spawn.ts";
import type { RepoPaths } from "./core/paths.ts";

/**
 *   kc dream                      start one in the background (returns at once; the panel shows it when done)
 *   kc dream run [--no-model]     run now and print what it found
 *   kc dream show [id] · list · apply <id> · discard <id> · undo <id> · skip <id> <finding> [off]
 */
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60_000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

export function printDream(r: DreamReport): string {
  const head = `Dream ${r.id} · ${r.status} · ${ago(r.ts)} · ${r.model ?? "checks only"} · read ${r.transcripts} chats, ${r.evidenceCount} facts, ${r.entryCount} notes · ${(r.ms / 1000).toFixed(1)} s`;
  const lines = [head];
  if (r.error) lines.push(`  failed: ${r.error}`);
  if (r.modelError) lines.push(`  the model step failed (checks still ran): ${r.modelError}`);
  if (!r.findings.length && !r.error) lines.push("  Nothing to fix: your memory matches what happened.");
  const ev = new Map(r.evidence.map((e) => [e.id, e]));
  for (const f of r.findings) {
    lines.push(`  ${f.skip ? "[skipped] " : ""}${f.id} ${f.kind.toUpperCase()} ${f.label}${f.line ? `:${f.line}` : ""}  →  ${f.action.op === "none" ? "for you to decide" : f.action.op === "move" ? `move to ${f.action.to} (${(f.action.paths ?? []).join(", ")})` : f.action.op === "replace" ? `rewrite: "${f.action.text}"` : f.action.op === "add-lesson" ? `add lesson: "${f.action.text}"` : f.action.op}`);
    if (f.entry) lines.push(`      "${f.entry.replace(/\s+/g, " ").slice(0, 140)}"`);
    lines.push(`      why: ${f.why}`);
    for (const id of f.evidence) { const e = ev.get(id); if (e) lines.push(`      ${id} ${e.ts.slice(0, 16).replace("T", " ")}: ${e.text}`); }
  }
  return lines.join("\n");
}

export async function dreamCommand(args: string[], p: RepoPaths, self: string, node: string): Promise<number> {
  const [sub, a, b, c] = args;
  switch (sub ?? "start") {
    case "start": {
      const run = dreaming(p);
      if (run) { console.log(`A Dream is already running (since ${ago(run.since)}).`); return 0; }
      spawnDream(p, self, node);
      console.log("Dream started in the background. It takes a minute or two; the panel shows it when done (or: kc dream show).");
      return 0;
    }
    case "run": {
      try {
        const r = await runDream(p, { model: !args.includes("--no-model") });
        console.log(printDream(r));
        return r.status === "failed" ? 1 : 0;
      } catch (err) { console.error(String((err as Error).message ?? err)); return 1; }
    }
    case "list":
      for (const r of listDreams(p)) console.log(`${r.id}  ${r.status.padEnd(9)} ${String(r.findings.length).padStart(2)} findings  ${ago(r.ts)}`);
      return 0;
    case "show": {
      const r = a ? readDream(p, a) : listDreams(p, 1)[0];
      console.log(r ? printDream(r) : "No Dreams yet. Run: kc dream");
      return r ? 0 : 1;
    }
    case "apply": console.log(applyDream(p, a ?? "")); return 0;
    case "discard": console.log(discardDream(p, a ?? "")); return 0;
    case "undo": console.log(undoDream(p, a ?? "")); return 0;
    case "skip": {
      const ok = skipFinding(p, a ?? "", b ?? "", c !== "off");
      console.log(ok ? (c === "off" ? "Put back into Apply." : "Left out of Apply.") : "No such proposed Dream or finding.");
      return ok ? 0 : 1;
    }
    default:
      console.log("kc dream [run|list|show|apply|discard|undo|skip]");
      return 2;
  }
}
