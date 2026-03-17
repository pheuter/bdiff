#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { parseJsonc, extractPackages, diffPackages } from "./parse";
import type { LockfileDiff } from "./parse";

// ── ANSI ────────────────────────────────────────────────────────────────────

const noColor = !!process.env.NO_COLOR;

const a = noColor
  ? {
      green: (s: string) => s,
      red: (s: string) => s,
      dim: (s: string) => s,
      bold: (s: string) => s,
      yellow: (s: string) => s,
      cyan: (s: string) => s,
    }
  : {
      green: (s: string) => `\x1b[32m${s}\x1b[0m`,
      red: (s: string) => `\x1b[31m${s}\x1b[0m`,
      dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
      bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
      yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
      cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
    };

// ── Git helpers ─────────────────────────────────────────────────────────────

function gitShow(ref: string, path: string): string | null {
  const proc = Bun.spawnSync(["git", "show", `${ref}:${path}`], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return null;
  return proc.stdout.toString();
}

function getLockPath(): string {
  const proc = Bun.spawnSync(["git", "rev-parse", "--show-prefix"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const prefix = proc.exitCode === 0 ? proc.stdout.toString().trim() : "";
  return prefix + "bun.lock";
}

async function resolveContents(
  positionals: string[],
  cached: boolean
): Promise<{ oldContent: string | null; newContent: string | null; label: string }> {
  const lockPath = getLockPath();

  if (positionals.length === 0 && !cached) {
    // HEAD vs working tree
    const oldContent = gitShow("HEAD", lockPath);
    const newContent = await Bun.file("bun.lock").text().catch(() => null);
    return { oldContent, newContent, label: "HEAD vs working tree" };
  }

  if (positionals.length === 0 && cached) {
    // HEAD vs staged
    return {
      oldContent: gitShow("HEAD", lockPath),
      newContent: gitShow(":0", lockPath),
      label: "staged changes",
    };
  }

  const arg = positionals[0];

  if (arg.includes("..")) {
    const parts = arg.split(/\.{2,3}/);
    const from = parts[0] || "HEAD";
    const to = parts[1] || "HEAD";
    return {
      oldContent: gitShow(from, lockPath),
      newContent: gitShow(to, lockPath),
      label: `${from} \u2192 ${to}`,
    };
  }

  // Single ref: compare ref → HEAD
  return {
    oldContent: gitShow(arg, lockPath),
    newContent: gitShow("HEAD", lockPath),
    label: `${arg} \u2192 HEAD`,
  };
}

// ── Table renderer ──────────────────────────────────────────────────────────

function renderTable(diff: LockfileDiff, label: string): void {
  const { added, removed, updated } = diff;
  const total = added.length + removed.length + updated.length;

  if (total === 0) {
    console.log(a.dim("\n  bun.lock unchanged.\n"));
    return;
  }

  // Summary
  console.log();
  console.log(`  ${a.bold("bdiff")} ${a.dim(`\u2014 ${label}`)}`);
  console.log();

  const parts: string[] = [];
  if (updated.length > 0) parts.push(a.yellow(`${updated.length} updated`));
  if (added.length > 0) parts.push(a.green(`${added.length} added`));
  if (removed.length > 0) parts.push(a.red(`${removed.length} removed`));
  console.log(`  ${parts.join(a.dim("  \u00b7  "))}`);
  console.log();

  // Compute column widths
  const allNames = [
    ...updated.map((u) => u.name),
    ...added.map((p) => p.name),
    ...removed.map((p) => p.name),
  ];
  const maxName = Math.min(50, Math.max(...allNames.map((n) => n.length)));

  // Updated
  if (updated.length > 0) {
    console.log(`  ${a.bold("Updated")}`);
    const maxFrom = Math.max(...updated.map((u) => u.from.length));

    for (const u of updated) {
      const name = u.name.padEnd(maxName + 2);
      const from = u.from.padStart(maxFrom);
      console.log(
        `  ${a.dim(name)}${a.red(from)}  ${a.dim("\u2192")}  ${a.green(u.to)}`
      );
    }
    console.log();
  }

  // Added
  if (added.length > 0) {
    console.log(`  ${a.bold(a.green("Added"))}`);
    for (const p of added) {
      const name = p.name.padEnd(maxName + 2);
      console.log(`  ${a.dim(name)}${a.green(p.version)}`);
    }
    console.log();
  }

  // Removed
  if (removed.length > 0) {
    console.log(`  ${a.bold(a.red("Removed"))}`);
    for (const p of removed) {
      const name = p.name.padEnd(maxName + 2);
      console.log(`  ${a.dim(name)}${a.red(p.version)}`);
    }
    console.log();
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const HELP = `
  ${a.bold("bdiff")} - See what changed in your bun.lock

  ${a.bold("Usage")}
    bdiff [options] [<ref> | <from>..<to>]

  ${a.bold("Arguments")}
    (none)         Compare HEAD vs working tree
    --cached       Compare HEAD vs staged
    <ref>          Compare <ref> vs HEAD
    <from>..<to>   Compare two refs

  ${a.bold("Options")}
    -h, --help     Show this help

  ${a.bold("Examples")}
    bdiff                  What changed since last commit
    bdiff --cached         What's staged
    bdiff HEAD~1           What the last commit changed
    bdiff main..feature    What a branch changed
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h", default: false },
      cached: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const { oldContent, newContent, label } = await resolveContents(
    positionals,
    values.cached!
  );

  if (!oldContent && !newContent) {
    console.error(a.red("\n  bun.lock not found.\n"));
    process.exit(1);
  }

  let oldPkgs = new Map<string, string>();
  let newPkgs = new Map<string, string>();

  try {
    if (oldContent) oldPkgs = extractPackages(parseJsonc(oldContent));
  } catch (e) {
    console.error(a.red(`  Failed to parse old bun.lock: ${e}`));
    process.exit(1);
  }

  try {
    if (newContent) newPkgs = extractPackages(parseJsonc(newContent));
  } catch (e) {
    console.error(a.red(`  Failed to parse new bun.lock: ${e}`));
    process.exit(1);
  }

  const diff = diffPackages(oldPkgs, newPkgs);
  renderTable(diff, label);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
