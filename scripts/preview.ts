// See the panel without the app: mounts every page and the status strip through `claude plugin test` with this
// project's real status, then draws each element tree as HTML (an approximation of Claude Desktop's surface) in
// docs/preview/ (git-ignored, it holds your own data), dark and light, docked and maximized. Open the files in a
// browser to screenshot them. Usage: node scripts/preview.ts [cols…]   (default 70 160)
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = process.env.PREVIEW_OUT ? resolve(process.env.PREVIEW_OUT) : join(ROOT, "docs/preview"); // PREVIEW_OUT: another folder (a mock beside the real thing)
const cols = process.argv.slice(2).map(Number).filter(Boolean);
const COLS = cols.length ? cols : [70, 160];

// PREVIEW_PROJECT: draw another project's status instead (the README shots use the benchmark's dummy project)
// PREVIEW_STATUS: a status JSON file to draw instead (a state that is hard to reach for real, e.g. a Dream waiting for you)
// PREVIEW_FROM: draw element trees saved earlier (a mock edited from real trees) instead of running the harness
const fromFile = process.env.PREVIEW_FROM;
const status = fromFile ? "" : process.env.PREVIEW_STATUS ? readFileSync(process.env.PREVIEW_STATUS, "utf8").trim() : spawnSync(process.execPath, [join(ROOT, "src/cli.ts"), "status", "--json"], { cwd: process.env.PREVIEW_PROJECT || ROOT, encoding: "utf8" }).stdout.trim();
const mod = mkdtempSync(join(tmpdir(), "cortex-preview-"));
cpSync(join(ROOT, "claude-plugin"), mod, { recursive: true });
rmSync(join(mod, "tests"), { recursive: true, force: true });
mkdirSync(join(mod, "tests"));
writeFileSync(join(mod, "tests/preview.test.tsx"), readFileSync(join(ROOT, "scripts/preview/preview.test.tsx"), "utf8").replace("__STATUS__", status).replace("__COLS__", JSON.stringify(COLS)));
const run = fromFile ? { stdout: "", stderr: "" } : spawnSync("claude", ["plugin", "test", mod], { encoding: "utf8", maxBuffer: 64 << 20 });
rmSync(mod, { recursive: true, force: true });
const shots = fromFile ? JSON.parse(readFileSync(fromFile, "utf8")) as { name: string; tree: El }[] : (run.stdout + run.stderr).split("\n").filter((l) => l.startsWith("@@PREVIEW ")).map((l) => JSON.parse(l.slice(10)) as { name: string; tree: El });
if (!shots.length) { console.error(run.stdout + run.stderr); process.exit(1); }
if (process.env.PREVIEW_DUMP) writeFileSync(process.env.PREVIEW_DUMP, JSON.stringify(shots.filter((x) => x.name.startsWith(process.env.PREVIEW_DUMP_PREFIX ?? "strip")))); // the strip trees, for a side-by-side mock

type El = { type: string; props?: Record<string, unknown>; children?: (El | string)[] } | string | null;
// PREVIEW_LOOK=kapex: the Kapex look's grounds (claude-plugin/hooks/look-colors.ts), as people with it on see the panel:
// Obsidian and Mist, on surface-2 (the app frosts its side panes in surface-2). Otherwise Claude's stock grounds.
// success / warning / error are the text colours the look's builder derives (vendor/make-colors.js text-*), not the role hexes.
const LOOK = process.env.PREVIEW_LOOK ?? "";
// PREVIEW_LOOK=amoled: the AMOLED ground (pure black panes, the v4.6 default dark look); kapex: Obsidian
const THEMES = LOOK === "kapex" || LOOK === "amoled" ? {
  dark: { bg: LOOK === "amoled" ? "#000000" : "#101714", text: "#E8F1EC", subtle: "#B4C3BB", inactive: "#8E9D96", border: "rgba(232,241,236,0.13)", btn: "rgba(232,241,236,0.06)", success: "#00A247", warning: "#E18F06", error: "#F37689" },
  light: { bg: "#FBFDFC", text: "#0B1912", subtle: "#33473D", inactive: "#52645A", border: "rgba(11,25,18,0.14)", btn: "rgba(11,25,18,0.04)", success: "#0E612D", warning: "#81390F", error: "#96112F" },
} : {
  dark: { bg: "#262624", text: "#ECEBE6", subtle: "#A9A79F", inactive: "#7C7A73", border: "rgba(255,255,255,0.14)", btn: "rgba(255,255,255,0.06)", success: "#4EBA65", warning: "#FFC107", error: "#FF6B80" },
  light: { bg: "#FAF9F5", text: "#1F1E1D", subtle: "#62615C", inactive: "#94928B", border: "rgba(0,0,0,0.14)", btn: "rgba(0,0,0,0.04)", success: "#2C7A39", warning: "#966C1E", error: "#AB2B3F" },
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CELL = 7.2, ROW = 20, UNIT = 8;
const len = (v: unknown, unit: number) => (typeof v === "number" ? `${v * unit}px` : typeof v === "string" ? v : "");
const color = (v: unknown) => (typeof v !== "string" ? "" : ["text", "subtle", "inactive", "success", "warning", "error"].includes(v) ? `var(--${v})` : v);

function draw(e: El): string {
  if (e === null || e === undefined || e === false as unknown) return "";
  if (typeof e === "string" || typeof e === "number") return esc(String(e));
  const p = e.props ?? {};
  const kids = (e.children ?? []).map(draw).join("");
  const css: string[] = [];
  const set = (k: string, v: string) => { if (v) css.push(`${k}:${v}`); };
  switch (e.type) {
    case "Box": {
      if (p.display === "none") return "";
      set("display", "flex");
      set("flex-direction", String(p.flexDirection ?? "row"));
      set("gap", len(p.gap, UNIT)); set("row-gap", len(p.rowGap, UNIT)); set("column-gap", len(p.columnGap, UNIT));
      set("padding", len(p.padding, UNIT));
      if (p.paddingX !== undefined) { set("padding-left", len(p.paddingX, UNIT)); set("padding-right", len(p.paddingX, UNIT)); }
      if (p.paddingY !== undefined) { set("padding-top", len(p.paddingY, UNIT)); set("padding-bottom", len(p.paddingY, UNIT)); }
      for (const s of ["Top", "Bottom", "Left", "Right"]) set(`padding-${s.toLowerCase()}`, len(p[`padding${s}`], UNIT));
      for (const s of ["Top", "Bottom", "Left", "Right"]) set(`margin-${s.toLowerCase()}`, len(p[`margin${s}`], UNIT));
      set("width", len(p.width, CELL)); set("height", len(p.height, ROW)); set("min-width", len(p.minWidth, CELL));
      set("align-items", String(p.alignItems ?? "")); set("justify-content", String(p.justifyContent ?? ""));
      set("flex-wrap", String(p.flexWrap ?? "")); set("flex-grow", p.flexGrow !== undefined ? String(p.flexGrow) : "");
      set("flex-shrink", p.flexShrink !== undefined ? String(p.flexShrink) : ""); set("flex-basis", len(p.flexBasis, CELL));
      set("background", color(p.backgroundColor) === "transparent" ? "" : color(p.backgroundColor));
      if (p.borderStyle) { set("border", `1px solid ${color(p.borderColor) || "var(--border)"}`); set("border-radius", "10px"); }
      set("overflow", p.overflow === "hidden" ? "hidden" : "");
      return `<div style="${css.join(";")}">${kids}</div>`;
    }
    case "Text": {
      set("color", color(p.color)); set("font-size", p.size === "caption" ? "12px" : p.size === "heading" ? "15px" : p.size === "title" ? "20px" : "");
      set("font-weight", p.weight === "semibold" ? "600" : p.weight === "bold" ? "700" : p.weight === "medium" ? "500" : p.size === "heading" || p.size === "title" ? "600" : "");
      if (p.wrap === "truncate-end") css.push("white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0");
      if (p.italic) css.push("font-style:italic")
      if (p.strikethrough) css.push("text-decoration:line-through");
      return `<span class="t" style="${css.join(";")}">${kids}</span>`;
    }
    case "Button": {
      const cls = p.plain ? "b plain" : p.variant === "primary" ? "b primary" : "b";
      // the app draws the label when there is one, and a hotkey as a small badge after it (it takes room: keep it)
      return `<span class="${cls}">${p.label ? esc(String(p.label)) : kids}${p.hotkey && !p.plain ? `<span class="hk">${esc(String(p.hotkey).toUpperCase())}</span>` : ""}</span>`;
    }
    case "Svg": if (!p.alt) return ""; // like the app: an Svg with an empty alt is not drawn
      // inline, like Desktop's frame: the system font resolves (an <img> SVG falls back to a wider one)
      return `<span role="img" aria-label="${esc(String(p.alt ?? ""))}" title="${esc(String(p.alt ?? ""))}" style="flex:none;display:inline-flex;width:${p.width}px;height:${p.height}px">${String(p.source ?? "").replace(/^<svg([^>]*?) width="[\d.]+" height="[\d.]+"/, `<svg$1 width="${p.width}" height="${p.height}"`)}</span>`;
    case "Input": return `<span class="in"><span class="t" style="font-size:12px;color:var(--subtle)">${esc(String(p.label ?? ""))}</span><span class="field">${esc(String(p.value || p.placeholder || ""))}</span></span>`;
    case "Select": {
      const opts = (p.options as { value: string; label?: string }[] | undefined) ?? [];
      const cur = opts.find((o) => o.value === p.value) ?? opts[0];
      return `<span class="in"><span class="t" style="font-size:12px;color:var(--subtle)">${esc(String(p.label ?? ""))}</span><span class="field">${esc(String(cur?.label ?? cur?.value ?? ""))} ▾</span></span>`;
    }
    case "Link": return `<a class="t" style="color:#10B981">${esc(String(p.label ?? p.href ?? ""))}</a>`;
    case "Markdown": return `<div class="t" style="white-space:pre-wrap">${esc(String(p.source ?? p.text ?? kids))}</div>`;
    default: return `<div data-type="${esc(e.type)}">${kids}</div>`;
  }
}

function page(title: string, frames: { theme: keyof typeof THEMES; width: number; tree: El }[]): string {
  const style = `body{margin:0;padding:16px;background:#888;font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif}
  .frames{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}.f{flex:none;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.3)}
  .f>div{background:var(--bg);color:var(--text);box-sizing:border-box}.t{display:inline;overflow-wrap:anywhere}
  .b{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid var(--border);border-radius:8px;background:var(--btn);font-size:14px;white-space:nowrap;flex:none}.hk{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;border-radius:4px;background:var(--btn);border:1px solid var(--border);font-size:10.5px;color:var(--subtle)}
  .b.primary{background:var(--text);color:var(--bg);border-color:transparent}.b.primary .t{color:inherit!important}.b.plain{border:none;background:none;padding:2px 4px;color:var(--text)}
  .in{display:flex;flex-direction:column;gap:2px;min-width:160px}.field{border:1px solid var(--border);border-radius:7px;padding:4px 8px}`;
  const vars = (t: keyof typeof THEMES) => Object.entries(THEMES[t]).map(([k, v]) => `--${k}:${v}`).join(";");
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>${style}</style><div class="frames">${frames.map((f) => `<div class="f" style="${vars(f.theme)};width:${f.width}px"><div style="padding:0">${draw(f.tree)}</div></div>`).join("")}</div><script>if (location.hash) document.body.style.zoom = location.hash.slice(1)</script>`; // #0.6 shrinks a page to fit a small window
}

mkdirSync(OUT, { recursive: true });
const names: string[] = [];
for (const s of shots) {
  if (s.name === "strip") {
    const fr = [600, 760].flatMap((w) => (["dark", "light"] as const).map((theme) => ({ theme, width: w, tree: { type: "Box", props: { padding: 1 }, children: [s.tree] } as El })));
    writeFileSync(join(OUT, "strip.html"), page("strip", fr)); names.push("strip"); continue;
  }
  const c = Number(/-(\d+)$/.exec(s.name)?.[1] ?? 70);
  const w = Math.round(Math.max(220, Math.min(1400, c * CELL)) + 16);
  const fr = c > 100 ? [{ theme: "dark" as const, width: w, tree: s.tree }] : (["dark", "light"] as const).map((theme) => ({ theme, width: w, tree: s.tree }));
  writeFileSync(join(OUT, `${s.name}.html`), page(s.name, fr)); names.push(s.name);
}
writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>Cortex preview</title><ul>${names.map((n) => `<li><a href="${n}.html">${n}</a></li>`).join("")}</ul>`);
console.log(`${names.length} screens in ${OUT}`);
