# Test conventions

## 100% test coverage

Per the [100 Percent Code Coverage][1] section of "AI is forcing us to
write good code", aim at 100% code coverage across statements,
branches, functions, and lines.  Avoid `c8 ignore` directives at all
costs – for example, prefer making assumptions which would fail loudly
instead of adding checks for things that are always true to your
knowledge.

When a code path is unreachable from integration tests but lives in a
pure function, prefer exporting the function for a focused unit test
over `c8 ignore`.  Comparators and parsers are the typical candidates.

[1]: https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false#%C2%A7100-percent-code-coverage

## Framework

Node.js built-in test runner (`node --test`).  Import `test` from
`node:test` and `assert` from `node:assert/strict`.

## Style

- Two kinds of tests: unit tests import `src/` functions directly;
  integration tests run the CLI as a subprocess via `run_script` and
  friends from `helpers.ts`.
- No dynamic imports.
- Multi-line string literals (3+ lines): use an array of strings joined
  with `.join('\n')`, one element per source line.  End the array with
  `''` to produce a trailing newline (omit only when testing the
  no-trailing-newline case):
  ```ts
  [
      '# My Skill',
      '',
      'Some text.',
      '',
  ].join('\n')
  ```
- Use `make_tmp_dir()` for all temporary directories; never hard-code
  paths.
- Use `.ante`/`.post` suffixes (not `.old`/`.new`) when comparing
  before/after file states.

## Helpers (`helpers.ts`)

- `run_script(args, options?)` — generic CLI invocation; returns
  `{stdout, stderr, code}`.
- `run_init(skill_dir, deploy_dir?, flags?, options?)` — runs `init`.
- `run_deploy(skill_dir, options?)` — sets up git, commits, runs
  `deploy`.
- `run_lint(skill_dir, flags?)` — sets up git, commits, runs `lint`.
- `setup_git(dir)` / `git_commit(dir)` — low-level git helpers.
- `strip_env_comments(content)` — strips comment lines from `.env`
  content for assertion.
