// Drive Claude Code like the Desktop app: one long-lived engine process, stream-json in/out.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROBE_DOCKER, PROBE_MEMORY, SCRIPT, type Fixture } from "./scenario.ts";

export function claudeEngine(): string {
  const base = join(homedir(), "Library", "Application Support", "Claude", "claude-code");
  if (existsSync(base)) {
    const versions = readdirSync(base).sort().reverse();
    for (const v of versions) {
      for (const h of readdirSync(join(base, v))) {
        const bin = join(base, v, h, "claude.app", "Contents", "MacOS", "claude");
        if (existsSync(bin)) return bin;
      }
    }
  }
  return join(homedir(), ".local", "bin", "claude");
}

export interface ClaudeRun { memoryReply: string; docker: { attempted: boolean; reply: string }; seconds: number; turns: number }

export function runClaude(fx: Fixture, model = "haiku"): Promise<ClaudeRun> {
  const t0 = Date.now();
  const p = spawn(claudeEngine(), [
    "--output-format", "stream-json", "--verbose", "--input-format", "stream-json",
    "--setting-sources=user,project,local", "--model", model, "--permission-mode", "default",
    "--allowedTools", "Read,Glob,Grep",
  ], { cwd: fx.root, stdio: ["pipe", "pipe", "ignore"] });
  let buf = "";
  let waiter: ((r: any) => void) | null = null;
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const ev = JSON.parse(line);
        if (ev.type === "result" && waiter) { const w = waiter; waiter = null; w(ev); }
      } catch { /* not json */ }
    }
  });
  const turn = (text: string) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("claude turn timed out")), 600_000);
      waiter = (ev) => { clearTimeout(timer); resolve(ev); };
      p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
    });
  return (async () => {
    let n = 0;
    for (const step of SCRIPT) { await turn(step.kind === "compact" ? "/compact" : step.text); n++; }
    const mem = await turn(PROBE_MEMORY);
    const dock = await turn(PROBE_DOCKER);
    n += 2;
    await new Promise((r) => setTimeout(r, 3_000)); // let Stop/SessionEnd hooks finish
    p.stdin.end();
    setTimeout(() => p.kill(), 15_000).unref();
    const denied = JSON.stringify(dock.permission_denials ?? []);
    return {
      memoryReply: String(mem.result ?? ""),
      docker: { attempted: /docker/i.test(denied), reply: String(dock.result ?? "") },
      seconds: Math.round((Date.now() - t0) / 1000),
      turns: n,
    };
  })();
}
