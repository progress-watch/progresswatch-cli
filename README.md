# Progress Watch CLI

Report progress from any script, crawler, CI job or agent, and watch it from anywhere.
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
progresswatch space new "My stuff"                     # saved as the default
TASK=$(progresswatch new "Crawl docs")                 # a task to report against
progresswatch update $TASK --current 1200 --end 50000  # in your loop
progresswatch done $TASK                               # sends the notification
```

Already have a space — someone shared it, or you made it in the browser:

```bash
progresswatch space use <uuid> --server https://progress.watch
```

Either way the choice is written to `~/.progresswatchrc` and every later command uses it.
In CI there is no config file to write, so use the environment variables instead — see
[Configuration](#configuration).

`new`, `update` and `done` are what you will type most. When the process is not yours to
change, `progresswatch run "python train.py"` wraps it instead — no counts, just a start
and a finish, but nothing to edit.

---

## Commands

```
progresswatch status                         check the current space's server
progresswatch configure --server <url>       point this machine at your own server
progresswatch space new [title] [--local]    create a space, save as default
progresswatch space list                     spaces known locally
progresswatch space use <uuid> [--server <url>] [--local]   switch the default
progresswatch space unbind                   drop this directory's space
progresswatch connect                        print QR + deep link to pair the phone

progresswatch new <title> [--parent <uuid>]  create task, print uuid
progresswatch update <uuid> [--current N] [--end N] [--values k=v ...]
progresswatch start <uuid>                   mark task running, before it can count
progresswatch done <uuid>                    mark task finished
progresswatch list                           tasks in the default space
progresswatch show <uuid>                    task detail with children

progresswatch run <command>                  run a command and track it
```

### Reporting from inside the work

```bash
TASK=$(progresswatch new "Crawl docs")

progresswatch start $TASK

progresswatch update $TASK --current 1200 --end 50000 --values pages=1200 --values errors=3 --values log="Timeout on /foo, retrying"

progresswatch done $TASK
```

Progress is `current` out of `end`, not a percentage — the dashboard shows you
`1200 / 50000 pages`, which tells you something that `2.4%` does not. `end` can change
between calls; a crawler that discovers more URLs just sends a bigger number.

Send `start` when the work begins even if there is nothing to count yet. Without it the
task reads as "waiting for data", which looks identical to a reporter that died.

`--values` takes any flat `key=value` pairs. Numbers and `true`/`false` are sent as real
types, everything else as a string. A `log` key is rendered as the task's last line —
it is the *last* line, not a history.

**Every update replaces the whole state.** Leave `--values` out of a later call and the
stored values are cleared, not kept. Send your complete state each time.

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

If the task cannot be created — server down, wrong space — `run` fails immediately rather
than running your command untracked. Once it is running, nothing about reporting can take
your command down: a failed update is logged and the command carries on.

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

### Self-hosting

```bash
progresswatch configure --server https://pw.internal
progresswatch configure --list
```

`progresswatch status` answers the question that comes later — which space am I reporting
into, on which server, and is that server alive — and exits non-zero when it is not, so it
works as a gate in CI.

`configure` checks the server answers before saving it, and sets the host for spaces you
create *from now on*. Spaces you already have keep theirs — each one records the server it
was created against, so watching a hosted space and two self-hosted ones at once is
normal. `--list` prints what is actually in effect, and names the environment variable
when one is overriding.

`--space` points a single command at a different space, and therefore at its server:

```bash
progresswatch show "$TASK" --space "$OTHER_SPACE_UUID"
progresswatch run --space "$WORK_SPACE" "make deploy"
```

With no space selected at all, commands addressed by task uuid fail rather than guess a
server to talk to.

### A directory can have its own space

```bash
progresswatch space new "Crawler" --local
progresswatch space use 406d45fd-... --local
progresswatch space unbind
```

Everything run from that directory or below reports into that space whatever the default
is, and `PROGRESSWATCH_SPACE` still wins so CI is unaffected. The binding lives in
`~/.progresswatchrc` keyed by path rather than in a file inside the project — a space uuid
is a credential, and files in a project get committed.

### The space UUID is a credential

There are no accounts. Whoever knows a space UUID can read and write that space, so keep
it in a secret rather than a committed file, the way you would an API token. The server
cannot list your spaces — without accounts it has no idea which are yours — so losing the
UUID loses the space. `~/.progresswatchrc` is worth backing up.

---

## Pairing your phone

```bash
progresswatch connect
```

Prints a QR code and a link to the space:

```
https://progress.watch/s/406d45fd-...
```

Scan it, or open the link. It is an ordinary link with nothing to install, it carries its
own host so a self-hosted space works the same, and opening it is what records the space
on that device.

Add the page to the home screen to get notifications. On iOS that is a requirement rather
than a nicety: Safari delivers Web Push only to an installed web app.

---

## Using it from an AI agent

The package ships a skill at `skills/progresswatch-cli/`. Point your agent at it and it
reports its own long-running work into a space without further prompting — one task for
the job, one child task per step, closed as they finish.

If you would rather the agent skip the CLI, the server speaks MCP — see the
[server's README](https://github.com/progress-watch/progresswatch).

## Development

Requires Node 20 or newer.

```bash
npm install
npm run build      # esbuild -> dist/cli.js
npm test           # builds, then runs the suite against an in-process mock server
npm run typecheck
```

## License

[MIT](LICENSE). The server is AGPL-3.0 — this is a client, and putting a copyleft licence
on something people drop into CI scripts would cost adoption for nothing.
