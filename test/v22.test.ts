import assert from "node:assert/strict";
import { test } from "node:test";
import { KEYS, score } from "../bench/v3.ts";

test("bench v3 scorer: a reply that keeps every rule scores 12/12, a forgetful one doesn't", () => {
  const good = [
    "Commit message:\nlnk: add POST /api/links/:id/expire endpoint (LNK-42)\n\nPR title: add link expiry endpoint",
    'w.WriteHeader(404)\njson.NewEncoder(w).Encode(map[string]any{"err_code": "not_found", "ts": time.Now().UTC().Format(time.RFC3339)})\nlog: level=warn msg="link not found" code=abc1234\nEnv var: LNKY_BASE_URL',
    "1. chi\n2. 7 characters (base62)\n3. 302\n4. internal/<pkg>/..._test.go\n5. 120 requests per minute per IP",
  ];
  const s = score(good);
  assert.deepEqual(KEYS.filter((k) => !s[k]), []);
  const bad = [
    "Commit: feat: add expire endpoint\nPR title: Add Link Expiry (Jira LNK-42)",
    '{"error": "not found", "time": "2026-11-09 10:00"}\nlog: {"level":"warn"}\nBASE_URL',
    "1. gin\n2. 6\n3. 301\n4. tests/\n5. 50 per minute",
  ];
  assert.equal(KEYS.filter((k) => score(bad)[k]).length, 0);
  // real answers from the 9 Nov runs: correct answers that *mention* the replaced value must still pass
  const real = score([
    "**Commit message**\n\n```\nlnk: add POST /api/links/:id/expire endpoint\n```\n\n**PR title**\n\n```\nadd post /api/links/:id/expire endpoint\n```",
    "",
    "1. chi — no gin or echo.\n2. Exactly 7 characters, base62.\n3. 302, not 301, since links can be edited.\n4. `internal/<pkg>/..._test.go`\n5. 120 requests per minute per IP (replaces the old 50).",
  ]);
  for (const k of ["commitPrefix", "lowercaseTitle", "chi", "sevenChars", "redirect302", "testsInternal", "rateLimit120"]) assert.equal(real[k], true, k);
  assert.equal(score(["", "", "5. The rate limit is 50 per minute.\n1. gin"]).rateLimit120, false, "the old value as the answer still fails");
});
