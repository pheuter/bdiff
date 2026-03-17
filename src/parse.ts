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

// Split a bun.lock package key into path segments, handling scoped packages.
// e.g. "@mapbox/node-pre-gyp/node-fetch/whatwg-url" → ["@mapbox/node-pre-gyp", "node-fetch", "whatwg-url"]
export function parseKeySegments(key: string): string[] {
  const segments: string[] = [];
  let i = 0;
  while (i < key.length) {
    if (key[i] === "@") {
      const scopeSlash = key.indexOf("/", i);
      if (scopeSlash === -1) { segments.push(key.slice(i)); break; }
      const nextSlash = key.indexOf("/", scopeSlash + 1);
      if (nextSlash === -1) { segments.push(key.slice(i)); break; }
      segments.push(key.slice(i, nextSlash));
      i = nextSlash + 1;
    } else {
      const nextSlash = key.indexOf("/", i);
      if (nextSlash === -1) { segments.push(key.slice(i)); break; }
      segments.push(key.slice(i, nextSlash));
      i = nextSlash + 1;
    }
  }
  return segments;
}

// Build a map from package key → direct workspace dependency that requires it.
// Traces through the dependency graph to find the root cause.
// Direct deps are omitted from the map.
export function buildOriginMap(lockData: unknown): Map<string, string> {
  if (!lockData || typeof lockData !== "object") return new Map();
  const data = lockData as Record<string, unknown>;

  // 1. Collect direct deps from workspace entries
  const directDeps = new Set<string>();
  const workspaces = data.workspaces;
  if (workspaces && typeof workspaces === "object") {
    for (const ws of Object.values(workspaces as Record<string, unknown>)) {
      if (!ws || typeof ws !== "object") continue;
      const wsObj = ws as Record<string, unknown>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const deps = wsObj[field];
        if (deps && typeof deps === "object") {
          for (const name of Object.keys(deps as Record<string, unknown>)) {
            directDeps.add(name);
          }
        }
      }
    }
  }

  const packages = data.packages;
  if (!packages || typeof packages !== "object") return new Map();
  const pkgEntries = packages as Record<string, unknown[]>;

  // 2. Build reverse dep map: depName → parent package names that list it
  const reverseMap = new Map<string, string[]>();
  for (const [key, value] of Object.entries(pkgEntries)) {
    if (!Array.isArray(value) || value.length < 3) continue;
    const meta = value[2];
    if (!meta || typeof meta !== "object") continue;
    const segs = parseKeySegments(key);
    const parentName = segs[segs.length - 1];
    for (const field of ["dependencies", "optionalDependencies"]) {
      const deps = (meta as Record<string, unknown>)[field];
      if (!deps || typeof deps === "object" === false) continue;
      for (const depName of Object.keys(deps as Record<string, unknown>)) {
        if (!reverseMap.has(depName)) reverseMap.set(depName, []);
        reverseMap.get(depName)!.push(parentName);
      }
    }
  }

  // 3. Trace each package back to a direct dep via BFS
  function traceToDirectDep(name: string): string | null {
    const visited = new Set<string>();
    const queue = [name];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (directDeps.has(current)) return current;
      if (visited.has(current)) continue;
      visited.add(current);
      const parents = reverseMap.get(current);
      if (parents) queue.push(...parents);
    }
    return null;
  }

  const origins = new Map<string, string>();
  for (const key of Object.keys(pkgEntries)) {
    const segments = parseKeySegments(key);
    const leafName = segments[segments.length - 1];

    // Skip direct deps (single-segment keys that are in workspace deps)
    if (segments.length === 1 && directDeps.has(leafName)) continue;

    // For nested keys, start from root segment; for top-level transitive, start from self
    const startName = segments.length > 1 ? segments[0] : leafName;
    if (directDeps.has(startName)) {
      origins.set(key, startName);
    } else {
      const origin = traceToDirectDep(startName);
      if (origin) origins.set(key, origin);
    }
  }

  return origins;
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
