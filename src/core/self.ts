import { isSea } from "node:sea";

/**
 * How Cortex calls itself. Two ways it can run:
 *   node <path>/src/cli.ts …   → node = the Node binary, cli = the script path
 *   cortex[.exe] …             → a single-file binary (Node SEA): node = the binary itself, cli = ""
 * Every launcher, hook command, skill and plugin template is written through these helpers,
 * so the same code produces working commands in both modes.
 */
export const IS_BINARY = (() => { try { return isSea(); } catch { return false; } })();

const quote = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

/** A shell command line: `"node" "cli"` or just `"cortex"` for the binary. */
export const cmdline = (node: string, cli: string) => (cli ? `${quote(node)} ${quote(cli)}` : quote(node));

/** An argument vector for spawn / exec-form hooks / MCP configs. */
export const argv = (node: string, cli: string, ...rest: string[]) => [node, ...(cli ? [cli] : []), ...rest];
