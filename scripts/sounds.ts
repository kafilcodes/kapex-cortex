// Cortex's own two sounds, synthesized here (no samples, no third-party audio): `node scripts/sounds.ts` writes
// claude-plugin/sounds/{done,alert}.wav. Deterministic: the same bytes every run.
//   done  — a soft rising "emerald glass" arpeggio, E5 → B5 → E6: bell partials (slightly inharmonic, like glass),
//           a 4 ms attack and a long gentle decay. Played when a handoff is saved or a Dream finishes.
//   alert — two warm notes stepping down, A4 → F4, rounder and quieter. Played when something needs you.
// Short (≤ 0.8 s) and quiet (peak −10 dBFS), so it reads as a nudge, not an alarm; unlike macOS's single-tone sounds.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RATE = 22_050;
type Note = { f: number; at: number; gain: number };
type Voice = { partials: [ratio: number, amp: number][]; decay: number };

function render(notes: Note[], voice: Voice, seconds: number, peak = 0.32): Int16Array {
  const n = Math.round(seconds * RATE), buf = new Float64Array(n);
  for (const note of notes) {
    const start = Math.round(note.at * RATE);
    for (let i = start; i < n; i++) {
      const t = (i - start) / RATE;
      const env = Math.min(1, t / 0.004) * Math.exp(-t / voice.decay);
      if (env < 1e-4 && t > 0.05) break;
      let v = 0;
      for (const [r, a] of voice.partials) v += a * Math.sin(2 * Math.PI * note.f * r * t) * Math.exp(-t * (r - 1) * 2.2); // upper partials fade first
      buf[i]! += v * env * note.gain;
    }
  }
  const max = Math.max(...buf.map(Math.abs)) || 1, fade = Math.round(0.06 * RATE);
  return Int16Array.from(buf, (v, i) => Math.round((v / max) * peak * 32767 * (i > n - fade ? (n - i) / fade : 1)));
}

function wav(samples: Int16Array): Buffer {
  const data = Buffer.from(samples.buffer), h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const glass: Voice = { partials: [[1, 1], [2.76, 0.22], [5.4, 0.07]], decay: 0.32 };
const warm: Voice = { partials: [[1, 1], [2, 0.18], [3.98, 0.05]], decay: 0.22 };
const out = resolve(import.meta.dirname, "..", "claude-plugin", "sounds");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "done.wav"), wav(render([{ f: 659.25, at: 0, gain: 0.8 }, { f: 987.77, at: 0.075, gain: 0.7 }, { f: 1318.51, at: 0.15, gain: 0.55 }], glass, 0.78)));
writeFileSync(join(out, "alert.wav"), wav(render([{ f: 440, at: 0, gain: 0.9 }, { f: 349.23, at: 0.13, gain: 0.85 }], warm, 0.6, 0.28)));
console.log(`wrote ${out}/done.wav and alert.wav`);
