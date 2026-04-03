# skill-shed

A Node.js CLI tool for managing AI coding agent skills: comment stripping,
deployment (with overwrite/stale detection), and linting.

## Stack

- Node.js 24+, TypeScript (ESM, no build step — runs via `node --loader` / `jiti`)
- Tests: `node --test` (Node.js built-in test runner)
- Linting: ESLint; type checking: `tsgo --noEmit`

## Commands

```
npm test [test/some.test.ts]   # run all or one test file
npm run typecheck
npm run lint
```

## Architecture

- `src/skill-shed.ts` — CLI entry point; dispatches to subcommands
- `src/init.ts` — `init` subcommand
- `src/deploy.ts` — `deploy` subcommand
- `src/manifest.ts` — builds the file manifest (list of source→target entries)
- `src/strip-html-comments.ts` — strips HTML comments from Markdown, respecting fenced code blocks
- `src/global-config.ts` — loads `~/.skill-shed.env` (or `$SKILL_SHED_CONFIG`)
- `src/sidecar.ts` — reads/writes `.skill-shed-manifest.json` in the target dir
- `src/utils.ts` — shared helpers
- `src/help.ts` — help text strings

## Key concepts

- `*.source.md` files: HTML comments are stripped on deploy; file is renamed to `*.md`
- `*.md` files (no `.source`): copied verbatim
- Global config: `~/.skill-shed.env` — sets `DEFAULT_TARGET_DIRECTORY`
- Per-skill config: `.env` in the skill directory — sets `TARGET_DIRECTORY`, optionally `MANIFEST_COMMAND`
- `MANIFEST_COMMAND`: custom shell command that lists skill files (one per line, relative paths)
- Sidecar file: `.skill-shed-manifest.json` in target dir — SHA-256 hashes of deployed files; drives overwrite/stale detection
- Sentinel file: `.skill-shed-deploy-in-progress` in target dir — written during deploy; detects interrupted deploys; `--force` clears it
- `ManifestEntry`: `{source_name, target_name, source_content, target_content, line_map?}`

## Deploy modes

| Flag | Behavior |
|------|----------|
| `--clean` (default) | Deploy last Git commit; abort if skill dir has any uncommitted changes |
| `--workdir` | Deploy working directory; exclude Git-ignored files |
| `--staged` | Deploy Git staging area (not yet implemented) |
| `--ref <ref>` | Deploy a specific Git ref (not yet implemented) |

## Planned / in-progress features (see JOURNAL.org)

- `config` subcommand (read-only, prints effective config)
- `strip` subcommand (print stripped content to stdout)
- `deploy --dry-run`
- Alternative source formats (Org → md via Emacs batch mode)
- Full help text for all config variables
