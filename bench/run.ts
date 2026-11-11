// decay-bench orchestrator.
// Usage: node bench/run.ts --harness opencode --model opencode/deepseek-v4.1-flash-free --runs 3 [--lines 200] [--only cortex|vanilla]
//        node bench/run.ts --harness claude --model haiku --runs 1 --lines 120
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { runClaude } from "./claude.ts";
import { runOpenCode } from "./opencode.ts";
import { makeFixture } from "./scenario.ts";
import { OBEDIENCE_KEYS, PRESENCE_KEYS, scorePresence, scoreReplies } from "./score.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const harness = arg("--harness", "opencode");
const model = arg("--model", harness === "claude" ? "haiku" : "opencode/deepseek-v4.1-flash-free");
const runs = Number(arg("--runs", "1"));
const lines = Number(arg("--lines", "200"));
const only = arg("--only", "");
const ROOT = resolve(import.meta.dirname, "..");
const cortexBin = join(ROOT, "bin", "cortex");
const outDir = join(ROOT, "bench", "results");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "runs-v2.jsonl");

const conditions = (only ? [only] : ["vanilla", "cortex"]) as ("vanilla" | "cortex")[];
for (let r = 1; r <= runs; r++) {
  for (const cond of conditions) {
    const fx = makeFixture({ cortex: cond === "cortex", linesPerFile: lines, cortexBin });
    const started = new Date().toISOString();
    try {
      if (harness === "opencode") {
        const [providerID, id] = model.split("/");
        const o = runOpenCode(fx, { providerID, id });
        const rec = { started, version: 2, harness, model, cond, run: r, lines, seconds: o.seconds, obedience: scoreReplies(o.memoryReply, o.docker), presence: scorePresence(o.contextText, o.instructionText), reply: o.memoryReply.slice(0, 1500), dockerReply: o.docker.reply.slice(0, 600), permissionAsks: o.docker.asked, fixture: fx.root, session: o.sessionID };
        appendFileSync(outFile, JSON.stringify(rec) + "\n");
        console.log(`${harness} ${model} ${cond} #${r} (${o.seconds}s) obey=${OBEDIENCE_KEYS.filter((k) => rec.obedience[k]).length}/${OBEDIENCE_KEYS.length} present=${PRESENCE_KEYS.filter((k) => rec.presence[k]).length}/${PRESENCE_KEYS.length} frenchRule=${rec.presence.frenchAsRule}`);
      } else {
        const c = await runClaude(fx, model);
        const rec = { started, version: 2, harness, model, cond, run: r, lines, seconds: c.seconds, obedience: scoreReplies(c.memoryReply, c.docker), reply: c.memoryReply.slice(0, 1500), dockerReply: c.docker.reply.slice(0, 600), fixture: fx.root };
        appendFileSync(outFile, JSON.stringify(rec) + "\n");
        console.log(`${harness} ${model} ${cond} #${r} (${c.seconds}s) obey=${OBEDIENCE_KEYS.filter((k) => rec.obedience[k]).length}/${OBEDIENCE_KEYS.length}`);
      }
    } catch (e) {
      appendFileSync(outFile, JSON.stringify({ started, harness, model, cond, run: r, lines, error: String((e as Error).message ?? e), fixture: fx.root }) + "\n");
      console.log(`${harness} ${model} ${cond} #${r} ERROR ${(e as Error).message}`);
    }
  }
}
