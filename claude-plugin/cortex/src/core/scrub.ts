/**
 * Redact common secret shapes before anything is persisted (SPEC §5.1).
 * Deliberately conservative: false positives cost a redacted word, false negatives leak a key.
 */
interface Pattern {
  name: string;
  re: RegExp;
  /** Replacement; `$1` etc. allowed. Defaults to a full redaction. */
  keep?: string;
}

const PATTERNS: Pattern[] = [
  { name: "private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "stripe-key", re: /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}/g },
  { name: "razorpay-key", re: /\brzp_(?:live|test)_[A-Za-z0-9]{14,}/g },
  { name: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "bearer", re: /\b(Bearer)\s+[A-Za-z0-9._~+/-]{20,}=*/g, keep: "$1 [REDACTED:bearer]" },
  { name: "url-credentials", re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, keep: "$1[REDACTED:url-credentials]@" },
  {
    name: "env-secret",
    re: /^(\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|CREDENTIALS?|AUTH)[A-Z0-9_]*\s*[=:]\s*)["']?[^\s"']{6,}["']?/gm,
    keep: "$1[REDACTED:env-secret]",
  },
];

export interface ScrubResult {
  text: string;
  count: number;
  kinds: string[];
}

export function scrub(input: string): ScrubResult {
  let text = input;
  let count = 0;
  const kinds: string[] = [];
  for (const p of PATTERNS) {
    text = text.replace(p.re, (...args: unknown[]) => {
      count++;
      if (!kinds.includes(p.name)) kinds.push(p.name);
      if (!p.keep) return `[REDACTED:${p.name}]`;
      return p.keep.replace(/\$(\d)/g, (_m, i: string) => String(args[Number(i)] ?? ""));
    });
  }
  return { text, count, kinds };
}
