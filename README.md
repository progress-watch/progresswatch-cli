# progresswatch

Report progress from any script, crawler, CI job or agent, and watch it on your phone.
Get a push notification when it finishes.

```bash
npm install -g progresswatch
```

This is the CLI. The server is at
[progress-watch/progresswatch](https://github.com/progress-watch/progresswatch) and can be
self-hosted with one `docker compose up`, or used hosted at
[progress.watch](https://progress.watch).

---

## Sixty seconds

```bash
progresswatch space new "My stuff"     # create a space, saved as the default
progresswatch connect                  # scan the QR with the app
progresswatch run "python train.py"    # watch it on your phone
```

Already have a space — someone shared it, or you made it in the browser:

```bash
progresswatch space use <uuid> --server https://progress.watch
```

Either way the choice is written to `~/.progresswatchrc` and every later command uses it.
Environment variables exist too, but they are for CI, where there is no config file to
write — see [Configuration](#configuration).

`run` is the whole product for a lot of people: it creates a task, runs your command,
streams the output through untouched, and marks the task done when it exits — with a
push notification to your phone. Nothing else to set up.

---

## Commands

```
progresswatch space new [title]              create a space, save as default
progresswatch space list                     spaces known locally
progresswatch space use <uuid> [--server <url>]  switch default, recording its server
progresswatch connect                        print QR + deep link to pair the phone

progresswatch new <title> [--parent <uuid>]  create task, print uuid
progresswatch update <uuid> [--current N] [--end N] [--values k=v ...]
progresswatch start <uuid>                   mark task running, before it can count
progresswatch done <uuid>                    mark task finished
progresswatch list                           tasks in the default space
progresswatch show <uuid>                    task detail with children

progresswatch run <command>                  run a command and track it
```

### `run`

```bash
progresswatch run "python train.py"
progresswatch run --title "Nightly training" "python train.py --epochs 100"
progresswatch run -- rsync -av /data /backup     # argv form, no shell involved
```

A single quoted argument runs through your shell, so pipes and `&&` work. Several
arguments are spawned directly with no shell in between.

The command's stdout and stderr pass through untouched, so `progresswatch run "..." > out.log`
behaves exactly as it would without the wrapper. `run` exits with the wrapped command's
exit code, and a non-zero exit is recorded on the task as `status=failed` with the code.

While the command runs, the task is refreshed periodically so it does not fall off the
server's inactivity timeout and so the app can tell it is still alive.

If the task cannot be created — server down, wrong space — `run` fails immediately
rather than running your command untracked. Once it is running, the opposite applies: a
failed progress report is logged and the command carries on.

### Reporting progress by hand

```bash
TASK=$(progresswatch new "Crawl docs")

progresswatch start $TASK

progresswatch update $TASK --current 1200 --end 50000 \
  --values pages=1200 --values errors=3 --values log="Timeout on /foo, retrying"

progresswatch done $TASK
```

Progress is `current` out of `end`, not a percentage — the app shows you
`1200 / 50000 pages`, which tells you something that `2.4%` does not. `end` can change
between calls; a crawler that discovers more URLs just sends a bigger number.

`start` exists because a created task reads as "waiting for data" until something arrives,
and that looks identical to a reporter that died before its first write. Send it when the
work begins, even if there is nothing to count yet.

`--values` takes any flat `key=value` pairs. Numbers and `true`/`false` are sent as real
types, everything else as a string. A `log` key is rendered as the task's last line —
it is the *last* line, not a history.

**Every update replaces the whole state.** If you leave `--values` out of a later call,
the stored values are cleared, not kept. Send your complete state each time; the process
doing the work always knows it, so this is simpler than tracking what you already sent.

### Nesting

One level. Useful when a job has distinct phases:

```bash
DEPLOY=$(progresswatch new "Deploy")
BUILD=$(progresswatch new "Build" --parent $DEPLOY)
TEST=$(progresswatch new "Test" --parent $DEPLOY)
```

The parent's progress is the average of its children's, so it moves on its own — you
never update it directly. A child cannot have children.

---

## Using it in scripts

The contract that makes this scriptable:

- **stdout carries machine-consumable output and nothing else** — a bare UUID, or JSON
  under `--json`
- **everything a human reads goes to stderr**, so it stays visible when you capture stdout
- **non-zero exit on failure**, always

```bash
#!/usr/bin/env bash
set -euo pipefail

export PROGRESSWATCH_SERVER="https://progress.watch"
export PROGRESSWATCH_SPACE="$MY_SPACE_UUID"

TOTAL=$(wc -l < urls.txt)
TASK=$(progresswatch new "Nightly crawl")

# Always finish the task, even if the script dies.
trap 'progresswatch done "$TASK" || true' EXIT

n=0
errors=0
while read -r url; do
  n=$((n + 1))
  if ! curl -sf "$url" -o "out/$n.html"; then
    errors=$((errors + 1))
  fi

  # Report every 50 URLs, not every one.
  if (( n % 50 == 0 )); then
    progresswatch update "$TASK" \
      --current "$n" --end "$TOTAL" \
      --values errors="$errors" --values log="Fetched $url"
  fi
done < urls.txt
```

Reading back in a script:

```bash
progresswatch show "$TASK" --json | jq -r '.progress.ratio'
progresswatch list --json | jq -r '.tasks[] | select(.finished_at == null) | .title'
```

Wrapping a whole CI step needs no bookkeeping at all:

```bash
progresswatch run --title "CI: integration suite" "bundle exec rspec"
```

---

## Configuration

A single file at `~/.progresswatchrc`, written with owner-only permissions:

```json
{
  "server": "https://progress.watch",
  "space": "406d45fd-f623-472a-acac-eef9b5281549",
  "spaces": [
    {
      "uuid": "406d45fd-f623-472a-acac-eef9b5281549",
      "title": "Production",
      "server": "https://progress.watch"
    }
  ]
}
```

Both settings are overridable by environment variable, which is how this is meant to be
used in CI:

| | |
|---|---|
| `PROGRESSWATCH_SERVER` | server URL; overrides the per-space server, for CI |
| `PROGRESSWATCH_SPACE` | space UUID, same as `--space` |
| `PROGRESSWATCH_CONFIG` | config file path, default `~/.progresswatchrc` |

### The server belongs to the space, not to your settings

Each space records the server it was created against. **There is no global "which server
am I using" setting** — one hosted space and two self-hosted ones at the same time is the
normal case, not a mode you switch between.

The top-level `server` in the config is only the value copied into the *next* space you
add. Changing it never repoints spaces you already have, which is what would otherwise
make a screenful of tasks appear to vanish.

`progresswatch configure` is how you set it:

```bash
progresswatch configure --server https://pw.internal
progresswatch configure --list
```

It checks the server before saving — `/up` has to answer, and answer that its database
and Redis are both up — because a config pointing at a host that is not there fails later
and somewhere else. `--list` prints what is actually in effect and names the environment
variable when one is doing the deciding.

A directory bound with `space use --local` needs no server of its own: it points at a
space, and the space carries the host.

Commands addressed by task uuid — `update`, `done`, `show` — need to know which space,
and therefore which server, to talk to. They use your default space, and `--space` points
them somewhere else for one command:

```bash
progresswatch show "$TASK" --space "$OTHER_SPACE_UUID"
progresswatch run --space "$WORK_SPACE" "make deploy"
```

If no space is selected at all, they fail rather than guessing a server.

### The space UUID is a credential

There are no accounts and no passwords. Whoever knows a space UUID can read and write
that space; sharing a space means giving someone the UUID. Keep it out of committed
files and CI logs — use a secret, the way you would with an API token.

`space list` shows only what this machine knows. The server has no way to list your
spaces, because without accounts it has no idea which ones are yours. Losing the UUID
means losing the space, so treat `~/.progresswatchrc` as worth backing up.

---

## Pairing your phone

```bash
progresswatch connect
```

Prints a QR code and a link to the space:

```
https://progress.watch/s/406d45fd-...
```

Scan it, or open the link on your phone. It is an ordinary link, not a custom URL scheme,
so it works with nothing installed — and opening the page is what records the space on
that device. The link carries its own host, so this works the same for the hosted service
and for your own box.

Add the page to the home screen to get notifications. On iOS that is a requirement rather
than a nicety: Safari delivers Web Push only to an installed web app.

---

## Using it from an AI agent

The package ships an agent skill at `skills/progresswatch-cli/`. Point your agent at it
and it will report its own long-running work into a space without further prompting — the
skill covers the command surface, the progress model, and the scripting contract.

```
skills/progresswatch-cli/
├── SKILL.md
└── references/
    ├── commands.md     every command and flag
    ├── reporting.md    what the numbers mean, nesting, the three states
    └── scripting.md    stdout/stderr, exit codes, CI, long-running jobs
```

If you would rather the agent call the API directly, the server also speaks MCP — see the
server's README.

## Development

Requires Node 20 or newer.

```bash
npm install
npm run build      # esbuild -> dist/cli.js
npm test           # builds, then runs the suite against an in-process mock server
npm run typecheck
```

There is no SDK package to depend on: the CLI talks to the API with native `fetch`,
because wrapping a single HTTP request would add nothing. The only runtime dependency is
a QR code generator.

## License

[MIT](LICENSE). The server is AGPL-3.0 — this is a client, and putting a copyleft licence
on something people drop into CI scripts would cost adoption for nothing.
