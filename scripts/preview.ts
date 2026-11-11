// See the panel without the app: mounts every page and the status strip through `claude plugin test` with this
// project's real status, then draws each element tree as HTML (an approximation of Claude Desktop's surface) in
// docs/preview/ (git-ignored, it holds your own data), dark and light, docked and maximized. Open the files in a
// browser to screenshot them. Usage: node scripts/preview.ts [cols…]   (default 70 160)
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "docs/preview");
const cols = process.argv.slice(2).map(Number).filter(Boolean);
const COLS = cols.length ? cols : [70, 160];

const status = spawnSync(process.execPath, [join(ROOT, "src/cli.ts"), "status", "--json"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const mod = mkdtempSync(join(tmpdir(), "cortex-preview-"));
cpSync(join(ROOT, "claude-plugin"), mod, { recursive: true });
rmSync(join(mod, "tests"), { recursive: true, force: true });
mkdirSync(join(mod, "tests"));
writeFileSync(join(mod, "tests/preview.test.tsx"), readFileSync(join(ROOT, "scripts/preview/preview.test.tsx"), "utf8").replace("__STATUS__", status).replace("__COLS__", JSON.stringify(COLS)));
const run = spawnSync("claude", ["plugin", "test", mod], { encoding: "utf8", maxBuffer: 64 << 20 });
rmSync(mod, { recursive: true, force: true });
const shots = (run.stdout + run.stderr).split("\n").filter((l) => l.startsWith("@@PREVIEW ")).map((l) => JSON.parse(l.slice(10)) as { name: string; tree: El });
if (!shots.length) { console.error(run.stdout + run.stderr); process.exit(1); }

type El = { type: string; props?: Record<string, unknown>; children?: (El | string)[] } | string | null;
const THEMES = {
  dark: { bg: "#262624", text: "#ECEBE6", subtle: "#A9A79F", inactive: "#7C7A73", border: "rgba(255,255,255,0.14)", btn: "rgba(255,255,255,0.06)" },
  light: { bg: "#FAF9F5", text: "#1F1E1D", subtle: "#62615C", inactive: "#94928B", border: "rgba(0,0,0,0.14)", btn: "rgba(0,0,0,0.04)" },
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CELL = 7.2, ROW = 20, UNIT = 8;
const len = (v: unknown, unit: number) => (typeof v === "number" ? `${v * unit}px` : typeof v === "string" ? v : "");
const color = (v: unknown) => (typeof v !== "string" ? "" : ["text", "subtle", "inactive"].includes(v) ? `var(--${v})` : v);

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
      if (p.italic) css.push("font-style:italic");
      return `<span class="t" style="${css.join(";")}">${kids}</span>`;
    }
    case "Button": {
      const cls = p.plain ? "b plain" : p.variant === "primary" ? "b primary" : "b";
      return `<span class="${cls}">${p.label ? esc(String(p.label)) : kids}</span>`; // the app draws the label when there is one
    }
    case "Svg": if (!p.alt) return ""; // like the app: an Svg with an empty alt is not drawn
      return `<img src="data:image/svg+xml;utf8,${encodeURIComponent(String(p.source ?? ""))}" width="${p.width}" height="${p.height}" alt="${esc(String(p.alt ?? ""))}" title="${esc(String(p.alt ?? ""))}" style="flex:none">`;
    case "Input": return `<span class="in"><span class="t" style="font-size:12px;color:var(--subtle)">${esc(String(p.label ?? ""))}</span><span class="field">${esc(String(p.value ?? p.placeholder ?? ""))}</span></span>`;
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
  .b{display:inline-flex;align-items:center;padding:3px 10px;border:1px solid var(--border);border-radius:7px;background:var(--btn);font-size:13px;white-space:nowrap;flex:none}
  .b.primary{background:var(--text);color:var(--bg);border-color:transparent}.b.primary .t{color:inherit!important}.b.plain{border:none;background:none;padding:2px 4px;color:var(--text);text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px}
  .in{display:flex;flex-direction:column;gap:2px;min-width:160px}.field{border:1px solid var(--border);border-radius:7px;padding:4px 8px}`;
  const vars = (t: keyof typeof THEMES) => Object.entries(THEMES[t]).map(([k, v]) => `--${k}:${v}`).join(";");
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>${style}</style><div class="frames">${frames.map((f) => `<div class="f" style="${vars(f.theme)};width:${f.width}px"><div style="padding:0">${draw(f.tree)}</div></div>`).join("")}</div>`;
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
