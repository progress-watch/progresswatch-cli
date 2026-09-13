---
name: progresswatch-cli
description: >
  Report progress from any long-running process via the Progress Watch CLI - create
  tasks, report counts, wrap commands, and get a push notification when work finishes.
  Use when the user wants to track a script, crawler, CI job, or agent from the shell,
  or asks to watch progress while it runs. Always load this skill before running
  `progresswatch` commands.
license: MIT
metadata:
  author: Progress Watch
  version: "0.0.2"
  homepage: https://progress.watch
  source: https://github.com/progress-watch/progresswatch-cli
  openclaw:
    emoji: "📊"
    requires:
      env:
        - PROGRESSWATCH_SPACE
      bins:
        - progresswatch
      primaryEnv: PROGRESSWATCH_SPACE
    install:
      - id: npm
        kind: npm
        package: progresswatch
        bins:
          - progresswatch
        label: Install Progress Watch CLI (npm)
---

## Agent Protocol

**Rules for agents:**
- `new` and `space new` print a bare uuid on stdout and nothing else — capture with `$(...)`.
- Everything a human reads goes to stderr. For machine-readable reads, pass `--json`.
- Every `update` **replaces the whole state**. Send the complete picture each time; anything omitted is cleared, not kept.
- Report counts, never percentages. `--current 1200 --end 50000`, not `--current 2.4`.
- Always finish a task with `done`. That is what sends the notification; an unfinished task sits at "waiting" until it expires.
- **Create the whole tree before the work starts.** Tasks created afterwards record what happened, accurately and too late for anyone watching.
- **Finish each step in the same breath as the work that finishes it**, and `start` it when it begins. Sweeping every `done` into one block at the end leaves the board empty for the whole run and green after it.
- **Keep adding steps as work appears.** The tree is a live picture, not a plan you committed to at the start. Work that was not foreseen gets its own step at the moment you find it, not folded into whichever step happens to be open.

## Setup

Set environment variables:
- `PROGRESSWATCH_SPACE` — the space uuid to report into. `progresswatch space new "My work"` creates one and saves it as the default, so the variable is only needed where there is no config file: CI, a container, a sandbox.
- `PROGRESSWATCH_SERVER` — server URL. Defaults to `https://progress.watch`; set it to your own host when self-hosting.

The space uuid is the credential — there are no accounts. Whoever has it can read and
write that space, and nothing on the server can recover it if lost. Keep it in a secret,
not in a committed file.

## Available Commands

| Command Group | What it does |
|---|---|
| `configure` | point this machine at a self-hosted server; `--list` shows what is in effect |
| `space` | new, list, use, unbind |
| `status` | check the current space's server; non-zero when it is unreachable |
| `connect` | print a QR code and deep link to pair a phone |
| task | `new`, `start`, `update`, `done`, `list`, `show` |
| `run` | wrap a command: create, stream, finish, report the exit code |

Read [references/commands.md](references/commands.md) for every flag.

**Self-hosting is `configure`.** `progresswatch configure --server https://pw.internal`
checks the server answers and records it, and every space created afterwards is created
there. It does not move existing spaces: the server is a property of each space, recorded
when it was added, so a machine can watch a hosted space and two self-hosted ones at once.
`progresswatch configure --list` prints what is actually in effect, including which
environment variable is overriding what.

**A directory can have its own space.** `progresswatch space new "Crawler" --local` creates
one and applies it to the working directory, and `space use <uuid> --local` does the same
for a space that already exists, and everything run from it or below reports there whatever the default
is. The binding lives in `~/.progresswatchrc` keyed by path, not in a file inside the
project — a space uuid is a credential, and a file in the project is the one that gets
committed. `PROGRESSWATCH_SPACE` still wins, so CI is unaffected.

## Common Mistakes

| # | Mistake | Fix |
|---|---|---|
| 1 | **Omitting `--values` on a later update and expecting the old ones to survive** | A write is a full overwrite. Re-send every value each time, or accept them being cleared |
| 2 | **Sending a percentage** | `--current`/`--end` are raw counts. "1200 of 50000 pages" is the point; the bar is computed |
| 3 | **Sending numbers to a parent, or never finishing it** | A parent's bar is averaged from its steps, so `--current`/`--end` on it are ignored. But nothing finishes a parent for you: `done` it once the last step is done, or it never notifies |
| 4 | **Nesting more than one level** | `--parent` may only point at a top-level task. A child cannot have children |
| 5 | **Piping `list` or `show` into a script** | Human output goes to stderr. Use `--json` and parse stdout |
| 6 | **Never calling `done`** | Nothing is sent until a task completes. Finish it even when the work failed, recording the failure in `--values` |
| 7 | **Reporting on every loop iteration** | Report meaningful steps. A crawler should update every N items, not every item |
| 8 | **Building the tree, then closing every step at the end** | Finish each step when its own work finishes. Batching the `done` calls is cheaper for the reporter and destroys the report |
| 9 | **Leaving a started step silent because it has nothing to count** | `progresswatch start "$STEP"` — until something arrives it reads as "waiting for data", which looks identical to a reporter that died |
| 10 | **Treating the tree as fixed once the work starts** | Add a step when the work appears. A parent's bar dropping because it gained a step is honest — it is the same as `end` growing when a crawler finds more URLs |

## Security

The space uuid is a bearer credential passed in the URL path to the server over HTTPS.
The CLI writes it to `~/.progresswatchrc` with owner-only permissions and never logs it.
`run` executes the command you give it — a single quoted argument goes through your shell,
several arguments are spawned directly with no shell involved. No CLI input is
interpolated into a shell command on your behalf.

## Common Patterns

**Report a loop — this is the common one, and the only shape that carries counts:**
```bash
TASK=$(progresswatch new "Crawl docs")
progresswatch update "$TASK" --current 1200 --end 50000 --values pages=1200 --values errors=3
progresswatch done "$TASK"
```

**Wrap a command you cannot change — start and finish, no counts:**
```bash
progresswatch run "python train.py"
```

**Break work into steps — created up front, closed as they finish:**
```bash
DEPLOY=$(progresswatch new "Deploy")
BUILD=$(progresswatch new "Build" --parent "$DEPLOY")
TEST=$(progresswatch new "Test" --parent "$DEPLOY")

progresswatch start "$BUILD"
npm run build && progresswatch done "$BUILD"

progresswatch start "$TEST"
npm test && progresswatch done "$TEST"

progresswatch done "$DEPLOY"
```

**Read progress back in a script:**
```bash
progresswatch show "$TASK" --json | jq -r '.progress.ratio'
progresswatch list --json | jq -r '.tasks[] | select(.finished_at == null) | .title'
```

**Always finish, even if the script dies:**
```bash
trap 'progresswatch done "$TASK" || true' EXIT
```

**Pair a phone:**
```bash
progresswatch connect
```

## When to Load References

- **Any command's flags and exact behaviour** → [references/commands.md](references/commands.md)
- **What the numbers mean, nesting, and why a bar looks the way it does** → [references/reporting.md](references/reporting.md)
- **Capturing output, exit codes, CI, and long-running jobs** → [references/scripting.md](references/scripting.md)
