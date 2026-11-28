import { applyDream, discardDream, dreaming, listDreams, readDream, runDream, skipFinding, undoDream, type DreamReport } from "./core/dream.ts";
import { decide, type Decision } from "./core/dream-decide.ts";
import { spawnDream } from "./core/dream-spawn.ts";
import { quickCheck } from "./core/dream-quick.ts";
import { askModel, judgeName } from "./core/backends.ts";
import type { RepoPaths } from "./core/paths.ts";
import { readPrefs } from "./core/prefs.ts";

/**
 *   kc dream                      start one in the background (returns at once; the panel shows it when done)
 *   kc dream run [--no-model]     run now and print what it found
 *   kc dream show [id] · list · apply <id> · discard <id> · undo <id> · skip <id> <finding> [off]
 *   kc dream test                 one small round trip to the model a full check would use: works, and how fast
 *   kc dream quick                the free check the Stop hook starts when a memory file or the code changed
 *   kc dream decide <id> <finding|all> apply|remove|keep|undo   one finding at a time (the panel's buttons)
 */
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60_000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

export function printDream(r: DreamReport): string {
  const head = `Memory check ${r.id} · ${r.status} · ${ago(r.ts)} · ${r.model ?? "checks only"} · read ${r.transcripts} chats, ${r.evidenceCount} facts, ${r.entryCount} notes · ${(r.ms / 1000).toFixed(1)} s`;
  const lines = [head];
  if (r.error) lines.push(`  failed: ${r.error}`);
  if (r.modelError) lines.push(`  the model step failed (checks still ran): ${r.modelError}`);
  if (!r.findings.length && !r.error) lines.push("  Nothing to fix: your memory matches what happened.");
  const ev = new Map(r.evidence.map((e) => [e.id, e]));
  for (const f of r.findings) {
    lines.push(`  ${f.done ? `[${f.done}] ` : f.skip ? "[skipped] " : ""}${f.id} ${f.kind.toUpperCase()} ${f.label}${f.line ? `:${f.line}` : ""}  →  ${f.action.op === "none" ? "for you to decide" : f.action.op === "move" ? `move to ${f.action.to} (${(f.action.paths ?? []).join(", ")})` : f.action.op === "replace" ? `rewrite: "${f.action.text}"` : f.action.op === "add-lesson" ? `add lesson: "${f.action.text}"` : f.action.op}`);
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
      if (run) { console.log(`A full check is already running (since ${ago(run.since)}).`); return 0; }
      spawnDream(p, self, node);
      console.log("Full check started in the background. It takes a minute or two; the panel shows it when done (or: kc dream show).");
      return 0;
    }
    case "run": {
      try {
        const r = await runDream(p, { model: !args.includes("--no-model") });
        console.log(printDream(r));
        return r.status === "failed" ? 1 : 0;
      } catch (err) { console.error(String((err as Error).message ?? err)); return 1; }
    }
    case "test": {
      // the same call a full check makes (its prompt shape, JSON answer, timeout), on a tiny question: proves the key, the
      // endpoint and the model before a real Dream spends a minute on them
      const pr = readPrefs(p);
      if (pr.dreamBackend === "off") { console.log("No model is set: a full check only runs Cortex's own checks."); return 0; }
      // the chosen judge only, never the fallback: this proves your key, address and model as they are
      const mine = pr.dreamBackend === "api"
      const cfg = mine ? { backend: "api", model: pr.dreamApiModel, api: pr.dreamApi, url: pr.dreamUrl } : { backend: "claude", model: pr.dreamModel || "sonnet", api: "anthropic" as const, url: "" }
      const who = judgeName(cfg.backend, cfg.model || "no model chosen")
      const after = mine ? ` Until it works, full checks fall back to Claude on your plan (${pr.dreamModel || "sonnet"}) and say so.` : ""
      const t = Date.now();
      try {
        const raw = await askModel(cfg, "Answer only with JSON.", 'Reply with exactly {"ok": true}.', { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, { timeoutMs: 60_000, effort: "low", maxTokens: 300 });
        const ok = /"ok"\s*:\s*true/.test(raw);
        console.log(ok ? `Works: ${who} answered in ${((Date.now() - t) / 1000).toFixed(1)} s.` : `${who} answered, but not in JSON (${raw.replace(/\s+/g, " ").slice(0, 80)}): full checks with it may fail; try another model.${after}`);
        return ok ? 0 : 1;
      } catch (err) { console.log(`Didn't work: ${who}: ${String((err as Error).message ?? err).slice(0, 300)}.${after}`); return 1; }
    }
    case "quick":
      try { console.log(await quickCheck(p)); return 0; } catch (err) { console.error(String((err as Error).message ?? err)); return 1; }
    case "list":
      for (const r of listDreams(p)) console.log(`${r.id}  ${r.status.padEnd(9)} ${String(r.findings.length).padStart(2)} findings  ${ago(r.ts)}`);
      return 0;
    case "show": {
      const r = a ? readDream(p, a) : listDreams(p, 1)[0];
      console.log(r ? printDream(r) : "No memory checks yet. Run: kc dream");
      return r ? 0 : 1;
    }
    case "apply": console.log(applyDream(p, a ?? "")); return 0;
    case "decide": {
      if (!["apply", "remove", "keep", "undo"].includes(c ?? "")) { console.error("kc dream decide <id> <finding|all> apply|remove|keep|undo"); return 2; }
      const out = decide(p, a ?? "", b ?? "", c as Decision);
      console.log(out);
      return /^(Applied|Removed|Kept|Undone)/.test(out) ? 0 : 1;
    }
    case "discard": console.log(discardDream(p, a ?? "")); return 0;
    case "undo": console.log(undoDream(p, a ?? "")); return 0;
    case "skip": {
      const ok = skipFinding(p, a ?? "", b ?? "", c !== "off");
      console.log(ok ? (c === "off" ? "Put back into Apply." : "Left out of Apply.") : "No such proposed check or finding.");
      return ok ? 0 : 1;
    }
    default:
      console.log("kc dream [run|test|list|show|apply|discard|undo|skip|decide]");
      return 2;
  }
}
