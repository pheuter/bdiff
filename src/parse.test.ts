import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { parseJsonc, extractPackages, diffPackages, parseKeySegments, buildOriginMap } from "./parse";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal bun.lock with a few packages */
const LOCK_MINIMAL = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "my-app",
      "dependencies": {
        "react": "^18.2.0",
        "react-dom": "^18.2.0",
      },
    },
  },
  "packages": {
    "react": ["react@18.2.0", "", { "dependencies": { "loose-envify": "^1.1.0" } }, "sha512-ABCxyz=="],
    "react-dom": ["react-dom@18.2.0", "", { "dependencies": { "loose-envify": "^1.1.0", "scheduler": "^0.23.0" } }, "sha512-DEFxyz=="],
    "loose-envify": ["loose-envify@1.4.0", "", { "dependencies": { "js-tokens": "^3.0.0 || ^4.0.0" } }, "sha512-HIJxyz=="],
    "js-tokens": ["js-tokens@4.0.0", "", {}, "sha512-KLMxyz=="],
    "scheduler": ["scheduler@0.23.0", "", { "dependencies": { "loose-envify": "^1.1.0" } }, "sha512-NoPxyz=="],
  },
}`;

/** bun.lock with scoped packages, URLs, and hashes */
const LOCK_SCOPED = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "my-app",
      "devDependencies": {
        "@types/react": "^18.2.0",
        "@babel/core": "^7.23.0",
        "@emotion/react": "^11.11.0",
      },
    },
  },
  "packages": {
    "@types/react": ["@types/react@18.2.48", "", { "dependencies": { "@types/prop-types": "*", "csstype": "^3.0.2" } }, "sha512-qboRCl6Ie70DQQG9hhNREz81jqC1cs9EVNcjQ1AU+jH6NFfSAhVVbrrY/+nSF+Bsk4AOwm9Qa61InvMCyV+H3w=="],
    "@babel/core": ["@babel/core@7.23.9", "", { "dependencies": { "@ampproject/remapping": "^2.2.0", "@babel/code-frame": "^7.23.5" } }, "sha512-5q0175NOjSVJUKhz1DcLqdGaMEFnZ1vAaW9+tZmITSBB0Z8E6IjYERQ9c+XJosL6C5SoS8Q8L8hmpMPt0v2lQ=="],
    "@emotion/react": ["@emotion/react@11.11.3", "", { "dependencies": { "@babel/runtime": "^7.18.3", "@emotion/cache": "^11.11.0" }, "peerDependencies": { "react": ">=16.8.0" } }, "sha512-Ve7GKecNhI30FRwZ19AxC1XAS/0+5aqGKMapyjav0E2ViASdtOEIYFllNX6+KTbNveDq3WQ0tlmWlsT/3mSFJw=="],
    "@types/prop-types": ["@types/prop-types@15.7.11", "", {}, "sha512-ga8y9v9uj6j2FSg/VIICo/GFG5QIJy01fhOv3VDm4lzmKmEPR3dQrTpXbAkBWbQsxOB9TYoAGmJCRpqq7VUDg=="],
    "csstype": ["csstype@3.1.3", "", {}, "sha512-M1uQkMl8rQK/szD0LNhtqxIPLpimGm8sOBwU7lLnCpSbTyY3yeU1Ber1oZWgWT4fMNQIx40vrr3YDAM6kGcel=="],
  },
}`;

/** bun.lock with monorepo workspaces */
const LOCK_MONOREPO = `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "monorepo",
      "devDependencies": {
        "turbo": "^2.0.0",
        "typescript": "^5.3.0",
      },
    },
    "packages/ui": {
      "name": "@myorg/ui",
      "dependencies": {
        "react": "^18.2.0",
      },
      "devDependencies": {
        "@types/react": "^18.2.0",
      },
    },
    "apps/web": {
      "name": "@myorg/web",
      "dependencies": {
        "@myorg/ui": "workspace:*",
        "next": "^14.0.0",
      },
    },
  },
  "packages": {
    "react": ["react@18.2.0", "", { "dependencies": { "loose-envify": "^1.1.0" } }, "sha512-ABCxyz=="],
    "@types/react": ["@types/react@18.2.48", "", {}, "sha512-DEFxyz=="],
    "next": ["next@14.1.0", "", { "dependencies": { "@next/env": "14.1.0", "postcss": "8.4.31" }, "peerDependencies": { "react": "^18.2.0", "react-dom": "^18.2.0" } }, "sha512-GHIxyz=="],
    "turbo": ["turbo@2.0.1", "", { "optionalDependencies": { "turbo-darwin-64": "2.0.1", "turbo-darwin-arm64": "2.0.1" } }, "sha512-JKLxyz=="],
    "typescript": ["typescript@5.3.3", "", { "bin": { "tsc": "bin/tsc", "tsserver": "bin/tsserver" } }, "sha512-MNOxyz=="],
    "loose-envify": ["loose-envify@1.4.0", "", {}, "sha512-PQRxyz=="],
  },
}`;

/** bun.lock with URLs containing // that previously broke the parser */
const LOCK_WITH_URLS = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "my-app",
      "dependencies": {
        "lodash": "^4.17.21",
      },
    },
  },
  // This lockfile has comments mixed with URL-like strings
  "packages": {
    "lodash": ["lodash@4.17.21", "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz", {}, "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg=="],
  },
}`;

/** Realistic lockfile similar to the careswitch monorepo format */
const LOCK_REALISTIC = `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "monorepo",
      "devDependencies": {
        "@types/bun": "^1.3.10",
        "@types/node": "^25.5.0",
        "eslint": "^10.0.3",
        "prettier": "^3.8.0",
        "typescript": "^5.9.3",
      },
    },
  },
  "packages": {
    "@ai-sdk/anthropic": ["@ai-sdk/anthropic@3.0.58", "", { "dependencies": { "@ai-sdk/provider": "3.0.8", "@ai-sdk/provider-utils": "4.0.19" }, "peerDependencies": { "zod": "^3.25.76 || ^4.1.8" } }, "sha512-/53SACgmVukO4bkms4dpxpRlYhW8Ct6QZRe6sj1Pi5H00hYhxIrqfiLbZBGxkdRvjsBQeP/4TVGsXgH5rQeb8Q=="],
    "@ai-sdk/provider": ["@ai-sdk/provider@3.0.8", "", { "dependencies": { "json-schema": "^0.4.0" } }, "sha512-oGMAgGoQdBXbZqNG0Ze56CHjDZ1IDYOwGYxYjO5KLSlz5HiNQ9udIXsPZ61VWaHGZ5XW/jyjmr6t2xz2jGVwbQ=="],
    "@ai-sdk/provider-utils": ["@ai-sdk/provider-utils@4.0.19", "", { "dependencies": { "@ai-sdk/provider": "3.0.8", "@standard-schema/spec": "^1.1.0", "eventsource-parser": "^3.0.6" }, "peerDependencies": { "zod": "^3.25.76 || ^4.1.8" } }, "sha512-3eG55CrSWCu2SXlqq2QCsFjo3+E7+Gmg7i/oRVoSZzIodTuDSfLb3MRje67xE9RFea73Zao7Lm4mADIfUETKGg=="],
    "@aws-sdk/client-s3": ["@aws-sdk/client-s3@3.1010.0", "", { "dependencies": { "@aws-crypto/sha256-browser": "5.2.0", "@aws-crypto/sha256-js": "5.2.0", "@aws-sdk/core": "^3.973.20" } }, "sha512-XUqXFrn/FGLLzO5OXu9iAtt492kj9Z7Yk8b0iPFxeJoIhaa61YOgR84chOExvnjm2+JTYyGNZiVPmgnFB3jxXA=="],
    "@types/bun": ["@types/bun@1.3.10", "", { "dependencies": { "bun-types": "1.3.10" } }, "sha512-ABCxyz=="],
    "@types/node": ["@types/node@25.5.0", "", {}, "sha512-DEFxyz=="],
    "eslint": ["eslint@10.0.3", "", { "dependencies": { "@eslint/core": "^0.15.0" }, "bin": { "eslint": "bin/eslint.js" } }, "sha512-GHIxyz=="],
    "prettier": ["prettier@3.8.0", "", { "bin": { "prettier": "bin/prettier.cjs" } }, "sha512-JKLxyz=="],
    "typescript": ["typescript@5.9.3", "", { "bin": { "tsc": "bin/tsc", "tsserver": "bin/tsserver" } }, "sha512-MNOxyz=="],
  },
}`;

// ── Helper to build a bun.lock string ───────────────────────────────────────

function buildLock(
  packages: Record<string, string>,
  name = "test-project"
): string {
  const deps = Object.keys(packages)
    .map((k) => `        "${k}": "^0.0.0",`)
    .join("\n");
  const pkgs = Object.entries(packages)
    .map(([k, v]) => `    "${k}": ["${k}@${v}", "", {}, "sha512-fake=="],`)
    .join("\n");
  return `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "${name}",
      "dependencies": {
${deps}
      },
    },
  },
  "packages": {
${pkgs}
  },
}`;
}

// ── parseJsonc ──────────────────────────────────────────────────────────────

describe("parseJsonc", () => {
  test("parses plain JSON", () => {
    expect(parseJsonc('{"a": 1}')).toEqual({ a: 1 });
  });

  test("strips line comments", () => {
    const input = `{
      // this is a comment
      "a": 1
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1 });
  });

  test("strips inline line comments", () => {
    const input = `{
      "a": 1, // inline comment
      "b": 2
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1, b: 2 });
  });

  test("strips block comments", () => {
    expect(parseJsonc(`{ /* comment */ "a": 1 }`)).toEqual({ a: 1 });
  });

  test("strips multi-line block comments", () => {
    const input = `{
      /*
       * multi-line
       * block comment
       */
      "a": 1
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1 });
  });

  test("removes trailing commas in objects", () => {
    expect(parseJsonc(`{ "a": 1, "b": 2, }`)).toEqual({ a: 1, b: 2 });
  });

  test("removes trailing commas in arrays", () => {
    expect(parseJsonc(`{ "a": [1, 2, 3,] }`)).toEqual({ a: [1, 2, 3] });
  });

  test("removes nested trailing commas", () => {
    const input = `{
      "a": {
        "b": [1, 2,],
        "c": 3,
      },
    }`;
    expect(parseJsonc(input)).toEqual({ a: { b: [1, 2], c: 3 } });
  });

  test("preserves // inside string values", () => {
    expect(
      parseJsonc(`{ "url": "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz" }`)
    ).toEqual({ url: "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz" });
  });

  test("preserves multiple // in a single string", () => {
    expect(
      parseJsonc(`{ "a": "http://x.com//path//to//thing" }`)
    ).toEqual({ a: "http://x.com//path//to//thing" });
  });

  test("preserves /* */ inside strings", () => {
    expect(
      parseJsonc(`{"a": "not a /* block */ comment"}`)
    ).toEqual({ a: "not a /* block */ comment" });
  });

  test("handles escaped quotes inside strings", () => {
    expect(parseJsonc(`{"a": "he said \\"hello\\""}`)).toEqual({
      a: 'he said "hello"',
    });
  });

  test("handles escaped backslash before quote", () => {
    // The string value is: a backslash followed by end of string
    expect(parseJsonc(`{"a": "\\\\\\\\"}`)).toEqual({ a: '\\\\' });
  });

  test("handles string with // after escaped quote", () => {
    // Value: `say "hi" // not a comment`
    expect(
      parseJsonc(`{"a": "say \\"hi\\" // not a comment"}`)
    ).toEqual({ a: 'say "hi" // not a comment' });
  });

  test("handles comments and trailing commas together", () => {
    const input = `{
      // comment
      "a": 1, // inline
      "b": 2,
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1, b: 2 });
  });

  test("handles empty input", () => {
    expect(parseJsonc("{}")).toEqual({});
    expect(parseJsonc("[]")).toEqual([]);
  });

  test("parses realistic bun.lock with URLs", () => {
    const data = parseJsonc(LOCK_WITH_URLS) as Record<string, Record<string, string[]>>;
    expect(data.packages.lodash[1]).toBe(
      "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"
    );
  });
});

// ── extractPackages ─────────────────────────────────────────────────────────

describe("extractPackages", () => {
  test("extracts simple packages", () => {
    const data = parseJsonc(LOCK_MINIMAL);
    const pkgs = extractPackages(data);
    expect(pkgs.get("react")).toBe("18.2.0");
    expect(pkgs.get("react-dom")).toBe("18.2.0");
    expect(pkgs.get("loose-envify")).toBe("1.4.0");
    expect(pkgs.get("js-tokens")).toBe("4.0.0");
    expect(pkgs.get("scheduler")).toBe("0.23.0");
    expect(pkgs.size).toBe(5);
  });

  test("extracts scoped packages", () => {
    const data = parseJsonc(LOCK_SCOPED);
    const pkgs = extractPackages(data);
    expect(pkgs.get("@types/react")).toBe("18.2.48");
    expect(pkgs.get("@babel/core")).toBe("7.23.9");
    expect(pkgs.get("@emotion/react")).toBe("11.11.3");
    expect(pkgs.get("@types/prop-types")).toBe("15.7.11");
    expect(pkgs.get("csstype")).toBe("3.1.3");
  });

  test("extracts monorepo packages", () => {
    const data = parseJsonc(LOCK_MONOREPO);
    const pkgs = extractPackages(data);
    expect(pkgs.get("react")).toBe("18.2.0");
    expect(pkgs.get("next")).toBe("14.1.0");
    expect(pkgs.get("turbo")).toBe("2.0.1");
    expect(pkgs.get("typescript")).toBe("5.3.3");
    expect(pkgs.size).toBe(6);
  });

  test("extracts from realistic lockfile", () => {
    const data = parseJsonc(LOCK_REALISTIC);
    const pkgs = extractPackages(data);
    expect(pkgs.get("@ai-sdk/anthropic")).toBe("3.0.58");
    expect(pkgs.get("@aws-sdk/client-s3")).toBe("3.1010.0");
    expect(pkgs.get("typescript")).toBe("5.9.3");
    expect(pkgs.size).toBe(9);
  });

  test("extracts from lockfile with URLs in entries", () => {
    const data = parseJsonc(LOCK_WITH_URLS);
    const pkgs = extractPackages(data);
    expect(pkgs.get("lodash")).toBe("4.17.21");
    expect(pkgs.size).toBe(1);
  });

  test("skips non-array entries", () => {
    const pkgs = extractPackages({
      packages: { react: ["react@18.2.0"], bad: "string", obj: { v: "1" } },
    });
    expect(pkgs.size).toBe(1);
  });

  test("skips empty arrays", () => {
    const pkgs = extractPackages({ packages: { empty: [], ok: ["ok@1.0.0"] } });
    expect(pkgs.size).toBe(1);
  });

  test("skips entries where first element is not a string", () => {
    const pkgs = extractPackages({ packages: { bad: [123] } });
    expect(pkgs.size).toBe(0);
  });

  test("skips entries without @ in spec", () => {
    const pkgs = extractPackages({ packages: { bad: ["no-version"] } });
    expect(pkgs.size).toBe(0);
  });

  test("returns empty map for missing/null/undefined input", () => {
    expect(extractPackages({})).toEqual(new Map());
    expect(extractPackages(null)).toEqual(new Map());
    expect(extractPackages(undefined)).toEqual(new Map());
    expect(extractPackages({ packages: null })).toEqual(new Map());
    expect(extractPackages({ packages: "string" })).toEqual(new Map());
  });
});

// ── diffPackages ────────────────────────────────────────────────────────────

describe("diffPackages", () => {
  test("detects added packages", () => {
    const diff = diffPackages(new Map(), new Map([["react", "18.2.0"]]));
    expect(diff.added).toEqual([{ name: "react", version: "18.2.0" }]);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  test("detects removed packages", () => {
    const diff = diffPackages(new Map([["react", "18.2.0"]]), new Map());
    expect(diff.removed).toEqual([{ name: "react", version: "18.2.0" }]);
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  test("detects updated packages", () => {
    const diff = diffPackages(
      new Map([["react", "18.2.0"]]),
      new Map([["react", "18.3.0"]])
    );
    expect(diff.updated).toEqual([
      { name: "react", from: "18.2.0", to: "18.3.0" },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test("detects no changes for identical maps", () => {
    const pkgs = new Map([
      ["react", "18.2.0"],
      ["lodash", "4.17.21"],
    ]);
    const diff = diffPackages(pkgs, new Map(pkgs));
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  test("handles mixed adds, removes, and updates", () => {
    const oldPkgs = new Map([
      ["react", "18.2.0"],
      ["lodash", "4.17.21"],
      ["moment", "2.29.0"],
    ]);
    const newPkgs = new Map([
      ["react", "18.3.0"],
      ["dayjs", "1.11.0"],
      ["moment", "2.29.0"],
    ]);
    const diff = diffPackages(oldPkgs, newPkgs);
    expect(diff.updated).toEqual([
      { name: "react", from: "18.2.0", to: "18.3.0" },
    ]);
    expect(diff.added).toEqual([{ name: "dayjs", version: "1.11.0" }]);
    expect(diff.removed).toEqual([{ name: "lodash", version: "4.17.21" }]);
  });

  test("sorts results alphabetically", () => {
    const diff = diffPackages(
      new Map(),
      new Map([
        ["zod", "3.0.0"],
        ["axios", "1.0.0"],
        ["mantine", "7.0.0"],
      ])
    );
    expect(diff.added.map((p) => p.name)).toEqual(["axios", "mantine", "zod"]);
  });

  test("sorts updates alphabetically", () => {
    const diff = diffPackages(
      new Map([
        ["zod", "2.0.0"],
        ["axios", "0.9.0"],
      ]),
      new Map([
        ["zod", "3.0.0"],
        ["axios", "1.0.0"],
      ])
    );
    expect(diff.updated.map((u) => u.name)).toEqual(["axios", "zod"]);
  });

  test("handles empty maps", () => {
    const diff = diffPackages(new Map(), new Map());
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  test("handles scoped package adds and removes", () => {
    const diff = diffPackages(
      new Map([["@types/react", "18.2.0"]]),
      new Map([["@types/node", "20.0.0"]])
    );
    expect(diff.removed).toEqual([
      { name: "@types/react", version: "18.2.0" },
    ]);
    expect(diff.added).toEqual([{ name: "@types/node", version: "20.0.0" }]);
  });

  test("handles large version jumps", () => {
    const diff = diffPackages(
      new Map([["@aws-sdk/client-s3", "3.400.0"]]),
      new Map([["@aws-sdk/client-s3", "3.1010.0"]])
    );
    expect(diff.updated).toEqual([
      { name: "@aws-sdk/client-s3", from: "3.400.0", to: "3.1010.0" },
    ]);
  });
});

// ── End-to-end: parse real bun.lock fixtures ────────────────────────────────

describe("end-to-end lockfile parsing", () => {
  test("parses minimal lock and diffs against empty", () => {
    const pkgs = extractPackages(parseJsonc(LOCK_MINIMAL));
    const diff = diffPackages(new Map(), pkgs);
    expect(diff.added.length).toBe(5);
    expect(diff.added.map((p) => p.name)).toContain("react");
    expect(diff.added.map((p) => p.name)).toContain("react-dom");
  });

  test("diffs two versions of a lockfile — upgrade react", () => {
    const oldLock = buildLock({ react: "18.2.0", lodash: "4.17.21" });
    const newLock = buildLock({ react: "18.3.0", lodash: "4.17.21" });
    const oldPkgs = extractPackages(parseJsonc(oldLock));
    const newPkgs = extractPackages(parseJsonc(newLock));
    const diff = diffPackages(oldPkgs, newPkgs);

    expect(diff.updated).toEqual([
      { name: "react", from: "18.2.0", to: "18.3.0" },
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test("diffs two versions — add a new dependency", () => {
    const oldLock = buildLock({ react: "18.2.0" });
    const newLock = buildLock({ react: "18.2.0", zod: "3.22.0" });
    const oldPkgs = extractPackages(parseJsonc(oldLock));
    const newPkgs = extractPackages(parseJsonc(newLock));
    const diff = diffPackages(oldPkgs, newPkgs);

    expect(diff.added).toEqual([{ name: "zod", version: "3.22.0" }]);
    expect(diff.updated).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test("diffs two versions — remove a dependency", () => {
    const oldLock = buildLock({ react: "18.2.0", moment: "2.29.4" });
    const newLock = buildLock({ react: "18.2.0" });
    const oldPkgs = extractPackages(parseJsonc(oldLock));
    const newPkgs = extractPackages(parseJsonc(newLock));
    const diff = diffPackages(oldPkgs, newPkgs);

    expect(diff.removed).toEqual([{ name: "moment", version: "2.29.4" }]);
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  test("diffs two versions — mixed changes", () => {
    const oldLock = buildLock({
      react: "18.2.0",
      lodash: "4.17.21",
      moment: "2.29.4",
      axios: "1.6.0",
    });
    const newLock = buildLock({
      react: "18.3.0",
      lodash: "4.17.21",
      dayjs: "1.11.10",
      axios: "1.7.0",
    });
    const oldPkgs = extractPackages(parseJsonc(oldLock));
    const newPkgs = extractPackages(parseJsonc(newLock));
    const diff = diffPackages(oldPkgs, newPkgs);

    expect(diff.updated).toEqual([
      { name: "axios", from: "1.6.0", to: "1.7.0" },
      { name: "react", from: "18.2.0", to: "18.3.0" },
    ]);
    expect(diff.added).toEqual([{ name: "dayjs", version: "1.11.10" }]);
    expect(diff.removed).toEqual([{ name: "moment", version: "2.29.4" }]);
  });

  test("diffs monorepo lockfile — replace framework", () => {
    const oldPkgs = extractPackages(parseJsonc(LOCK_MONOREPO));

    // Simulate switching from next to svelte
    const newLock = `{
      "lockfileVersion": 1,
      "packages": {
        "react": ["react@18.3.0", "", {}, "sha512-new=="],
        "@types/react": ["@types/react@18.2.48", "", {}, "sha512-same=="],
        "svelte": ["svelte@4.2.8", "", {}, "sha512-new=="],
        "turbo": ["turbo@2.0.1", "", {}, "sha512-same=="],
        "typescript": ["typescript@5.4.0", "", {}, "sha512-new=="],
        "loose-envify": ["loose-envify@1.4.0", "", {}, "sha512-same=="],
      },
    }`;
    const newPkgs = extractPackages(parseJsonc(newLock));
    const diff = diffPackages(oldPkgs, newPkgs);

    expect(diff.removed.map((p) => p.name)).toContain("next");
    expect(diff.added.map((p) => p.name)).toContain("svelte");
    expect(diff.updated.map((u) => u.name)).toContain("react");
    expect(diff.updated.map((u) => u.name)).toContain("typescript");
  });

  test("diffs realistic lockfile — upgrade SDK versions", () => {
    const oldPkgs = extractPackages(parseJsonc(LOCK_REALISTIC));

    const newLock = LOCK_REALISTIC
      .replace("@ai-sdk/anthropic@3.0.58", "@ai-sdk/anthropic@3.1.0")
      .replace("@ai-sdk/provider@3.0.8", "@ai-sdk/provider@3.1.0")
      .replace("@ai-sdk/provider-utils@4.0.19", "@ai-sdk/provider-utils@4.1.0")
      .replace(
        "@aws-sdk/client-s3@3.1010.0",
        "@aws-sdk/client-s3@3.1020.0"
      );
    const newPkgs = extractPackages(parseJsonc(newLock));
    const diff = diffPackages(oldPkgs, newPkgs);

    expect(diff.updated.length).toBe(4);
    expect(diff.updated.map((u) => u.name)).toEqual([
      "@ai-sdk/anthropic",
      "@ai-sdk/provider",
      "@ai-sdk/provider-utils",
      "@aws-sdk/client-s3",
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test("handles completely empty lockfile", () => {
    const lock = `{ "lockfileVersion": 1, "packages": {} }`;
    const pkgs = extractPackages(parseJsonc(lock));
    expect(pkgs.size).toBe(0);
  });
});

// ── parseKeySegments ────────────────────────────────────────────────────────

describe("parseKeySegments", () => {
  test("simple package name", () => {
    expect(parseKeySegments("react")).toEqual(["react"]);
  });

  test("scoped package name", () => {
    expect(parseKeySegments("@types/react")).toEqual(["@types/react"]);
  });

  test("unscoped transitive path", () => {
    expect(parseKeySegments("mongodb/bson")).toEqual(["mongodb", "bson"]);
  });

  test("scoped root with transitive deps", () => {
    expect(parseKeySegments("@mapbox/node-pre-gyp/node-fetch/whatwg-url")).toEqual([
      "@mapbox/node-pre-gyp",
      "node-fetch",
      "whatwg-url",
    ]);
  });

  test("scoped leaf in transitive path", () => {
    expect(parseKeySegments("express/@types/body-parser")).toEqual([
      "express",
      "@types/body-parser",
    ]);
  });

  test("scoped root and scoped leaf", () => {
    expect(parseKeySegments("@nestjs/core/@nestjs/common")).toEqual([
      "@nestjs/core",
      "@nestjs/common",
    ]);
  });

  test("deep nesting", () => {
    expect(parseKeySegments("a/b/c/d")).toEqual(["a", "b", "c", "d"]);
  });
});

// ── buildOriginMap ──────────────────────────────────────────────────────────

describe("buildOriginMap", () => {
  test("direct deps are not in the map", () => {
    const data = parseJsonc(LOCK_MINIMAL);
    const origins = buildOriginMap(data);
    expect(origins.has("react")).toBe(false);
    expect(origins.has("react-dom")).toBe(false);
  });

  test("traces single-level transitive dep to direct dep", () => {
    const data = parseJsonc(LOCK_MINIMAL);
    const origins = buildOriginMap(data);
    // loose-envify is required by react and react-dom
    const origin = origins.get("loose-envify");
    expect(origin === "react" || origin === "react-dom").toBe(true);
    // scheduler is required by react-dom
    expect(origins.get("scheduler")).toBe("react-dom");
  });

  test("traces multi-level transitive dep to direct dep", () => {
    const data = parseJsonc(LOCK_MINIMAL);
    const origins = buildOriginMap(data);
    // js-tokens is required by loose-envify, which is required by react/react-dom
    const origin = origins.get("js-tokens");
    expect(origin === "react" || origin === "react-dom").toBe(true);
  });

  test("traces scoped transitive deps", () => {
    const data = parseJsonc(LOCK_SCOPED);
    const origins = buildOriginMap(data);
    // @types/prop-types is required by @types/react
    expect(origins.get("@types/prop-types")).toBe("@types/react");
    // csstype is required by @types/react
    expect(origins.get("csstype")).toBe("@types/react");
  });

  test("traces nested key paths to direct dep", () => {
    // Simulate a lockfile with nested resolution paths
    const lockData = parseJsonc(`{
      "lockfileVersion": 1,
      "workspaces": {
        "": {
          "name": "my-app",
          "dependencies": {
            "mongodb": "^6.0.0",
          },
        },
      },
      "packages": {
        "mongodb": ["mongodb@6.0.0", "", { "dependencies": { "mongodb-connection-string-url": "^3.0.0" } }, "sha512-a=="],
        "mongodb-connection-string-url": ["mongodb-connection-string-url@3.0.0", "", { "dependencies": { "whatwg-url": "^14.0.0" } }, "sha512-b=="],
        "mongodb-connection-string-url/whatwg-url": ["whatwg-url@14.0.0", "", { "dependencies": { "tr46": "^5.0.0" } }, "sha512-c=="],
        "mongodb-connection-string-url/whatwg-url/tr46": ["tr46@5.0.0", "", {}, "sha512-d=="],
      },
    }`);
    const origins = buildOriginMap(lockData);
    // All should trace back to mongodb
    expect(origins.get("mongodb-connection-string-url")).toBe("mongodb");
    expect(origins.get("mongodb-connection-string-url/whatwg-url")).toBe("mongodb");
    expect(origins.get("mongodb-connection-string-url/whatwg-url/tr46")).toBe("mongodb");
  });

  test("handles monorepo with multiple workspaces", () => {
    const data = parseJsonc(LOCK_MONOREPO);
    const origins = buildOriginMap(data);
    // loose-envify is a transitive dep of react
    expect(origins.get("loose-envify")).toBe("react");
    // Direct deps should not be in the map
    expect(origins.has("react")).toBe(false);
    expect(origins.has("turbo")).toBe(false);
    expect(origins.has("typescript")).toBe(false);
  });

  test("handles devDependencies as direct deps", () => {
    const data = parseJsonc(LOCK_SCOPED);
    const origins = buildOriginMap(data);
    // @types/react, @babel/core, @emotion/react are devDeps → not in map
    expect(origins.has("@types/react")).toBe(false);
    expect(origins.has("@babel/core")).toBe(false);
    expect(origins.has("@emotion/react")).toBe(false);
  });

  test("returns empty map for missing/null/undefined input", () => {
    expect(buildOriginMap(null)).toEqual(new Map());
    expect(buildOriginMap(undefined)).toEqual(new Map());
    expect(buildOriginMap({})).toEqual(new Map());
    expect(buildOriginMap({ packages: null })).toEqual(new Map());
  });

  test("returns empty map when all packages are direct deps", () => {
    const lockData = parseJsonc(`{
      "lockfileVersion": 1,
      "workspaces": {
        "": {
          "name": "app",
          "dependencies": { "react": "^18.0.0", "lodash": "^4.0.0" },
        },
      },
      "packages": {
        "react": ["react@18.2.0", "", {}, "sha512-a=="],
        "lodash": ["lodash@4.17.21", "", {}, "sha512-b=="],
      },
    }`);
    const origins = buildOriginMap(lockData);
    expect(origins.size).toBe(0);
  });

  test("handles circular dependencies without infinite loop", () => {
    const lockData = parseJsonc(`{
      "lockfileVersion": 1,
      "workspaces": {
        "": {
          "name": "app",
          "dependencies": { "a": "^1.0.0" },
        },
      },
      "packages": {
        "a": ["a@1.0.0", "", { "dependencies": { "b": "^1.0.0" } }, "sha512-a=="],
        "b": ["b@1.0.0", "", { "dependencies": { "c": "^1.0.0" } }, "sha512-b=="],
        "c": ["c@1.0.0", "", { "dependencies": { "b": "^1.0.0" } }, "sha512-c=="],
      },
    }`);
    const origins = buildOriginMap(lockData);
    expect(origins.get("b")).toBe("a");
    expect(origins.get("c")).toBe("a");
  });
});

// ── Integration: bdiff CLI against real git repos ───────────────────────────

describe("integration: bdiff in git repos", () => {
  const bdiff = join(import.meta.dir, "index.ts");
  let tmpDir: string;

  function git(...args: string[]) {
    const proc = Bun.spawnSync(["git", ...args], {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test.com",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test.com",
      },
    });
    return proc.stdout.toString();
  }

  function runBdiff(...args: string[]) {
    const proc = Bun.spawnSync(["bun", "run", bdiff, ...args], {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    return {
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
      exitCode: proc.exitCode,
    };
  }

  function writeLock(content: string) {
    writeFileSync(join(tmpDir, "bun.lock"), content);
  }

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bdiff-test-"));
    git("init");
    git("checkout", "-b", "main");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reports no lockfile when repo has none", () => {
    const { stderr, exitCode } = runBdiff();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("bun.lock not found");
  });

  test("shows all packages as added for initial lockfile", () => {
    writeLock(buildLock({ react: "18.2.0", lodash: "4.17.21" }));
    const { stdout } = runBdiff();
    expect(stdout).toContain("Added");
    expect(stdout).toContain("react");
    expect(stdout).toContain("18.2.0");
    expect(stdout).toContain("lodash");
    expect(stdout).toContain("4.17.21");
    expect(stdout).toContain("2 added");
  });

  test("shows no changes after committing", () => {
    git("add", "bun.lock");
    git("commit", "-m", "initial lock");
    const { stdout } = runBdiff();
    expect(stdout).toContain("unchanged");
  });

  test("detects package upgrade in working tree", () => {
    writeLock(buildLock({ react: "18.3.0", lodash: "4.17.21" }));
    const { stdout } = runBdiff();
    expect(stdout).toContain("Updated");
    expect(stdout).toContain("react");
    expect(stdout).toContain("18.2.0");
    expect(stdout).toContain("18.3.0");
    expect(stdout).toContain("1 updated");
  });

  test("detects added package in working tree", () => {
    writeLock(
      buildLock({ react: "18.3.0", lodash: "4.17.21", zod: "3.22.0" })
    );
    const { stdout } = runBdiff();
    expect(stdout).toContain("Added");
    expect(stdout).toContain("zod");
    expect(stdout).toContain("3.22.0");
  });

  test("detects removed package in working tree", () => {
    writeLock(buildLock({ react: "18.3.0" }));
    const { stdout } = runBdiff();
    expect(stdout).toContain("Removed");
    expect(stdout).toContain("lodash");
  });

  test("detects mixed changes in working tree", () => {
    writeLock(
      buildLock({ react: "19.0.0", axios: "1.6.0" })
    );
    const { stdout } = runBdiff();
    expect(stdout).toContain("Updated");
    expect(stdout).toContain("react");
    expect(stdout).toContain("Added");
    expect(stdout).toContain("axios");
    expect(stdout).toContain("Removed");
    expect(stdout).toContain("lodash");
  });

  test("--cached compares HEAD vs staged", () => {
    // Reset working tree to committed state
    writeLock(buildLock({ react: "18.2.0", lodash: "4.17.21" }));
    git("checkout", "--", "bun.lock");

    // Stage a change
    writeLock(buildLock({ react: "18.2.0", lodash: "4.17.21", zod: "3.22.0" }));
    git("add", "bun.lock");

    const { stdout } = runBdiff("--cached");
    expect(stdout).toContain("staged changes");
    expect(stdout).toContain("zod");
    expect(stdout).toContain("1 added");
  });

  test("compares two commits with ref..ref syntax", () => {
    // Commit the staged change
    git("commit", "-m", "add zod");

    // Make another commit
    writeLock(
      buildLock({
        react: "18.3.0",
        lodash: "4.17.21",
        zod: "3.22.0",
      })
    );
    git("add", "bun.lock");
    git("commit", "-m", "upgrade react");

    const { stdout } = runBdiff("HEAD~1..HEAD");
    expect(stdout).toContain("Updated");
    expect(stdout).toContain("react");
    expect(stdout).toContain("18.2.0");
    expect(stdout).toContain("18.3.0");
  });

  test("compares single ref vs HEAD", () => {
    const { stdout } = runBdiff("HEAD~2");
    // HEAD~2 is the initial commit with react@18.2.0, lodash@4.17.21
    // HEAD has react@18.3.0, lodash@4.17.21, zod@3.22.0
    expect(stdout).toContain("Updated");
    expect(stdout).toContain("react");
    expect(stdout).toContain("Added");
    expect(stdout).toContain("zod");
  });

  test("compares branches with branch..branch syntax", () => {
    // Create a feature branch with different changes
    git("checkout", "-b", "feature");
    writeLock(
      buildLock({
        react: "19.0.0",
        lodash: "4.17.21",
        zod: "3.22.0",
        dayjs: "1.11.10",
      })
    );
    git("add", "bun.lock");
    git("commit", "-m", "feature changes");

    const { stdout } = runBdiff("main..feature");
    expect(stdout).toContain("Updated");
    expect(stdout).toContain("react");
    expect(stdout).toContain("19.0.0");
    expect(stdout).toContain("Added");
    expect(stdout).toContain("dayjs");

    // Go back to main
    git("checkout", "main");
  });

  test("handles lockfile with URLs and comments", () => {
    writeLock(LOCK_WITH_URLS);
    git("add", "bun.lock");
    git("commit", "-m", "lock with urls");

    // Modify to add a package
    const newLock = LOCK_WITH_URLS.replace(
      `"lodash": ["lodash@4.17.21"`,
      `"axios": ["axios@1.6.0", "", {}, "sha512-fake=="],\n    "lodash": ["lodash@4.17.21"`
    );
    writeLock(newLock);

    const { stdout, exitCode } = runBdiff();
    expect(exitCode).toBe(0);
    expect(stdout).toContain("axios");
    expect(stdout).toContain("1 added");
  });

  test("handles realistic monorepo lockfile", () => {
    writeLock(LOCK_REALISTIC);
    git("add", "bun.lock");
    git("commit", "-m", "realistic lock");

    // Upgrade some packages
    const upgraded = LOCK_REALISTIC
      .replace("typescript@5.9.3", "typescript@5.10.0")
      .replace("prettier@3.8.0", "prettier@3.9.0");
    writeLock(upgraded);

    const { stdout, exitCode } = runBdiff();
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Updated");
    expect(stdout).toContain("typescript");
    expect(stdout).toContain("prettier");
    expect(stdout).toContain("2 updated");
  });

  test("handles scoped packages in diffs correctly", () => {
    writeLock(LOCK_SCOPED);
    git("add", "bun.lock");
    git("commit", "-m", "scoped lock");

    // Upgrade scoped packages
    const upgraded = LOCK_SCOPED
      .replace("@types/react@18.2.48", "@types/react@18.3.0")
      .replace("@babel/core@7.23.9", "@babel/core@7.24.0")
      .replace("@emotion/react@11.11.3", "@emotion/react@11.12.0");
    writeLock(upgraded);

    const { stdout, exitCode } = runBdiff();
    expect(exitCode).toBe(0);
    expect(stdout).toContain("@types/react");
    expect(stdout).toContain("@babel/core");
    expect(stdout).toContain("@emotion/react");
    expect(stdout).toContain("3 updated");
  });

  test("--help shows usage", () => {
    const { stdout, exitCode } = runBdiff("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bdiff");
    expect(stdout).toContain("Usage");
    expect(stdout).toContain("--cached");
  });
});
