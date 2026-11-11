// Draws the Kapex Cortex mark as a PNG with no dependencies (node:zlib only), from the same shapes as the SVG
// in claude-plugin/hooks/logo.ts. Anti-aliased by 4×4 supersampling.
// Usage: node scripts/logo-png.ts <size> <out.png> [--bg]   (--bg paints the #08090A canvas; default transparent)
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { logoShapes } from "../claude-plugin/hooks/logo.ts";

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

function inPoly(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function renderPng(size: number, background: boolean): Buffer {
  const shapes = logoShapes().map((s) => ({ ...s, rgb: hex(s.fill) }));
  const SS = 4, scale = 64 / size, pad = 0.06; // a little margin so the mark never touches the edge
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // PNG filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        // sample point in logo units, shrunk around the centre by the margin
        const x = 32 + ((px + (sx + 0.5) / SS) * scale - 32) / (1 - 2 * pad);
        const y = 32 + ((py + (sy + 0.5) / SS) * scale - 32) / (1 - 2 * pad);
        let hit: [number, number, number] | null = null;
        for (const s of shapes) {
          const on = "circle" in s ? Math.hypot(x - s.circle[0], y - s.circle[1]) <= s.circle[2] : inPoly(x, y, s.points);
          if (on) hit = s.rgb; // later shapes paint over earlier ones, as in SVG
        }
        if (!hit && background) hit = [8, 9, 10];
        if (hit) { r += hit[0]; g += hit[1]; b += hit[2]; a += 255; }
      }
      const n = SS * SS, o = py * (size * 4 + 1) + 1 + px * 4;
      // un-premultiply so edges keep their colour on any background
      raw[o] = a ? Math.round((r * 255) / a) : 0; raw[o + 1] = a ? Math.round((g * 255) / a) : 0; raw[o + 2] = a ? Math.round((b * 255) / a) : 0; raw[o + 3] = Math.round(a / n);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

if (process.argv[1]?.endsWith("logo-png.ts")) {
  const size = Number(process.argv[2] ?? 1024);
  const out = process.argv[3] ?? "logo.png";
  writeFileSync(out, renderPng(size, process.argv.includes("--bg")));
  console.log(`wrote ${out} (${size}×${size})`);
}
