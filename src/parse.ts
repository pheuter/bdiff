export interface PackageEntry {
  name: string;
  version: string;
}

export interface PackageUpdate {
  name: string;
  from: string;
  to: string;
}

export interface LockfileDiff {
  added: PackageEntry[];
  removed: PackageEntry[];
  updated: PackageUpdate[];
}

// Parse JSONC (JSON with comments + trailing commas) used by bun.lock
export function parseJsonc(text: string): unknown {
  // Strip comments while respecting string literals
  let result = "";
  let i = 0;
  while (i < text.length) {
    // String literal — copy verbatim
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") j++; // skip escaped char
        j++;
      }
      result += text.slice(i, j + 1);
      i = j + 1;
    }
    // Line comment
    else if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    }
    // Block comment
    else if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += text[i];
      i++;
    }
  }
  // Remove trailing commas
  result = result.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(result);
}

// Extract package name → version map from parsed bun.lock
export function extractPackages(lockData: unknown): Map<string, string> {
  const pkgs = new Map<string, string>();
  if (!lockData || typeof lockData !== "object") return pkgs;
  const packages = (lockData as Record<string, unknown>).packages;
  if (!packages || typeof packages !== "object") return pkgs;

  for (const [key, value] of Object.entries(packages)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const spec = value[0];
    if (typeof spec !== "string") continue;

    // "package-name@version" — lastIndexOf handles scoped @scope/pkg@1.0.0
    const atIdx = spec.lastIndexOf("@");
    if (atIdx <= 0) continue;

    pkgs.set(key, spec.slice(atIdx + 1));
  }

  return pkgs;
}

// Compare old vs new package maps
export function diffPackages(
  oldPkgs: Map<string, string>,
  newPkgs: Map<string, string>
): LockfileDiff {
  const added: PackageEntry[] = [];
  const removed: PackageEntry[] = [];
  const updated: PackageUpdate[] = [];

  for (const [name, version] of oldPkgs) {
    if (!newPkgs.has(name)) {
      removed.push({ name, version });
    } else {
      const newVersion = newPkgs.get(name)!;
      if (newVersion !== version) {
        updated.push({ name, from: version, to: newVersion });
      }
    }
  }

  for (const [name, version] of newPkgs) {
    if (!oldPkgs.has(name)) {
      added.push({ name, version });
    }
  }

  added.sort((a, b) => a.name.localeCompare(b.name));
  removed.sort((a, b) => a.name.localeCompare(b.name));
  updated.sort((a, b) => a.name.localeCompare(b.name));

  return { added, removed, updated };
}
