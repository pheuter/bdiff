# bdiff

See what changed in your `bun.lock`.

```
  bdiff — HEAD vs working tree

  1 updated  ·  1 added  ·  1 removed

  Updated
  react          18.2.0  →  18.3.0

  Added
  zod            3.22.0

  Removed
  moment         2.29.4
```

## Install

```sh
bun add -g bdiff
```

Or run directly:

```sh
bunx bdiff
```

## Usage

```
bdiff [options] [<ref> | <from>..<to>]
```

| Command | What it compares |
|---|---|
| `bdiff` | HEAD vs working tree |
| `bdiff --cached` | HEAD vs staged |
| `bdiff HEAD~1` | Last commit vs HEAD |
| `bdiff main..feature` | Two refs |

### Options

- `-h, --help` — Show help
- `--cached` — Compare HEAD vs staged changes

## Requirements

- [Bun](https://bun.sh)
- Git repository with a `bun.lock` file

## License

MIT
