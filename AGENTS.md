# bdiff

CLI tool that shows human-readable diffs of `bun.lock` files. Parses the JSONC-formatted lockfile, extracts package versions, and displays added/removed/updated packages in a formatted table. Runs on Bun, written in TypeScript.

## Commands

- **Run**: `bun run dev`
- **Test**: `bun test`
- **Run a single test**: `bun test --test-name-pattern "pattern"`
- **Lint**: `bun run lint`
- **Typecheck**: `bun run typecheck`

## Architecture

Two source files:

- `src/index.ts` — CLI entrypoint. Handles argument parsing (`--cached`, ref ranges like `HEAD~1..main`), reads lockfile contents via git (`git show`) or filesystem, and renders the diff table with ANSI colors. Respects `NO_COLOR` env var.
- `src/parse.ts` — Pure logic, fully tested. Three exported functions:
  - `parseJsonc()` — Strips comments and trailing commas from bun.lock's JSONC format
  - `extractPackages()` — Builds a `Map<name, version>` from parsed lockfile data (handles scoped packages via `lastIndexOf("@")`)
  - `diffPackages()` — Compares two package maps, returns `{ added, removed, updated }` sorted alphabetically

Tests are in `src/parse.test.ts` and include both unit tests for each function and integration tests that spin up temporary git repos to test the full CLI.
