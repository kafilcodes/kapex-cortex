/**
 * One model call over HTTP, made sturdy for any provider a Dream may use: Anthropic, or any OpenAI-compatible
 * endpoint (OpenRouter, NVIDIA NIM, Groq, a local server). What real providers do, and what this does about it:
 *
 *   429 / 5xx / a dropped connection → wait and try again (honouring Retry-After), at most twice, inside the budget
 *   an answer that never comes        → each try gets what is left of one overall deadline, then a plain reason
 *   an error page that isn't JSON     → its status and first words, never a JSON parse error
 *   401 / 403 / 404 / 402             → what to fix: the key, the model's name, the credits
 *   a thinking model out of room      → (content empty, finish "length") one more try with three times the room
 *   <think>…</think> in the answer    → removed, so the JSON after it parses
 *   content as a list of parts        → its text parts joined
 *   JSON mode refused (400)           → asked again without it
 *   an endpoint ending /chat/completions → used as the base it is
 *
 * The key is sent only in its header and never appears in an error.
 */
export interface HttpModel { api: "anthropic" | "openai"; url: string; model: string; key: string }
export interface HttpOptions { timeoutMs: number; maxTokens: number; json?: boolean; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

const RETRY = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);
const TRIES = 3;
const nap = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The base of an OpenAI-compatible endpoint: no trailing slash, no /chat/completions someone pasted with it. */
export function apiBase(url: string): string { return url.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "").replace(/\/+$/, ""); }

/** Text from an answer's content: a string, or a list of parts (some providers), with any <think> block removed. */
export function answerText(content: unknown): string {
  const raw = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (typeof p === "string" ? p : typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : "")).join("") : "";
  return raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").replace(/^[\s\S]*<\/think(?:ing)?>/i, "").trim();
}

/** A plain reason for an HTTP failure. */
export function httpReason(status: number, body: string, model: string): string {
  let msg = "";
  try { const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string; detail?: string; title?: string }; msg = typeof j.error === "string" ? j.error : j.error?.message ?? j.message ?? j.detail ?? j.title ?? ""; } catch { msg = body.replace(/<[^>]+>/g, " "); }
  msg = msg.replace(/\s+/g, " ").trim().slice(0, 160);
  const hint = status === 401 || status === 403 ? "the API key was refused: check it, and that it may use this model"
    : status === 404 ? `no model "${model}" at this endpoint: check its exact name`
    : status === 402 ? "the account is out of credits"
    : status === 429 ? "rate limited: too many requests, try again in a minute"
    : status >= 500 ? "the provider had a problem on its side" : "the request was refused";
  return `${status}: ${hint}${msg ? ` (${msg})` : ""}`;
}

/** How long to wait before trying again: the server's Retry-After (seconds or a date), else 2 s then 6 s; at most 20 s. */
export function retryWait(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const s = Number(retryAfter);
    const ms = Number.isFinite(s) ? s * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(ms) && ms >= 0) return Math.min(20_000, ms);
  }
  return attempt === 1 ? 2_000 : 6_000;
}

type Reply = { status: number; body: string; headers: Headers }

/** Ask once, with retries for what is worth retrying, inside one overall deadline. */
async function send(m: HttpModel, body: object, o: HttpOptions, deadline: number): Promise<Reply> {
  const f = o.fetchImpl ?? fetch, sleep = o.sleep ?? nap
  const anthropic = m.api === "anthropic"
  const url = anthropic ? "https://api.anthropic.com/v1/messages" : `${apiBase(m.url)}/chat/completions`
  const headers: Record<string, string> = anthropic ? { "content-type": "application/json", "x-api-key": m.key, "anthropic-version": "2023-06-01" } : { "content-type": "application/json", authorization: `Bearer ${m.key}` }
  let last = ""
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const left = deadline - Date.now()
    if (left < 1_000) break
    try {
      const r = await f(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(left) })
      const text = await r.text()
      if (r.ok || !RETRY.has(r.status) || attempt === TRIES) return { status: r.status, body: text, headers: r.headers }
      last = httpReason(r.status, text, m.model)
      const wait = retryWait(attempt, r.headers.get("retry-after"))
      if (Date.now() + wait > deadline - 1_000) return { status: r.status, body: text, headers: r.headers }
      await sleep(wait)
    } catch (e) {
      const name = (e as Error).name
      if (name === "TimeoutError" || name === "AbortError") break
      last = `could not reach the endpoint (${String((e as Error).message ?? e).slice(0, 80)})`
      if (attempt === TRIES) throw new Error(last)
      await sleep(retryWait(attempt, null))
    }
  }
  throw new Error(`no answer within ${Math.round(o.timeoutMs / 1000)} s${last ? ` (last: ${last})` : ""}: the model may be busy or slow; try again, or pick a faster one`)
}

/** The model's text answer, or an Error with a plain reason. */
export async function callHttpModel(m: HttpModel, system: string, message: string, o: HttpOptions): Promise<string> {
  const deadline = Date.now() + o.timeoutMs
  let max = o.maxTokens, json = o.json ?? false
  for (let round = 0; round < 3; round++) {
    const body = m.api === "anthropic"
      ? { model: m.model, max_tokens: max, temperature: 0, system, messages: [{ role: "user", content: message }] }
      : { model: m.model, temperature: 0, max_tokens: max, messages: [{ role: "system", content: system }, { role: "user", content: message }], ...(json ? { response_format: { type: "json_object" } } : {}) }
    const r = await send(m, body, o, deadline)
    if (r.status === 400 && json && /response_format|json_object|json mode/i.test(r.body)) { json = false; continue }
    if (r.status < 200 || r.status >= 300) throw new Error(`${m.api === "anthropic" ? "Anthropic API" : "API"} ${httpReason(r.status, r.body, m.model)}`)
    let j: Record<string, unknown>
    try { j = JSON.parse(r.body) as Record<string, unknown> } catch { throw new Error(`the endpoint answered with something that isn't JSON (${r.body.replace(/\s+/g, " ").slice(0, 80)})`) }
    if (m.api === "anthropic") {
      const content = (j.content as { type: string; text?: string }[] | undefined) ?? []
      const text = answerText(content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""))
      if (!text && j.stop_reason === "max_tokens" && round === 0) { max = Math.min(32_000, max * 3); continue }
      if (!text) throw new Error("the model gave an empty answer")
      return text
    }
    const choice = (j.choices as { message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: string }[] | undefined)?.[0]
    if (!choice) throw new Error(`the endpoint's answer has no choices${typeof (j.error as { message?: string })?.message === "string" ? ` (${(j.error as { message: string }).message.slice(0, 120)})` : ""}`)
    const text = answerText(choice.message?.content)
    if (text) return text
    const thought = !!(choice.message?.reasoning_content || choice.message?.reasoning)
    if (choice.finish_reason === "length" && round === 0) { max = Math.min(32_000, max * 3); continue }
    throw new Error(thought ? `the model spent its whole answer thinking (finish: ${choice.finish_reason ?? "?"}): pick a model without long reasoning, or a larger one` : `the model gave an empty answer (finish: ${choice.finish_reason ?? "?"})`)
  }
  throw new Error("the model gave no usable answer")
}
