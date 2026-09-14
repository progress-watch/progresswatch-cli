# Progress Watch CLI

Report progress from any script, crawler, CI job or agent, and watch it from anywhere.
Get a push notification when it finishes.

```bash
npm install -g progresswatch
```

The server is [progress-watch/progresswatch](https://github.com/progress-watch/progresswatch),
hosted at [progress.watch](https://progress.watch) or run by yourself.

## Quick start

```bash
progresswatch space new "My stuff"                     # saved as the default
TASK=$(progresswatch new "Crawl docs")                 # a task to report against
progresswatch update $TASK --current 1200 --end 50000  # in your loop
progresswatch done $TASK                               # sends the notification
```

To report into a space you already have:

```bash
progresswatch space use <uuid> --server https://progress.watch
```

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
progresswatch list [--limit --before --after] tasks in the default space, unfinished first
progresswatch show <uuid>                    task detail with children

progresswatch run <command>                  run a command and track it
```

Every command supports `--help`.

### Reporting

```bash
TASK=$(progresswatch new "Crawl docs")
progresswatch start $TASK
progresswatch update $TASK --current 1200 --end 50000 --values pages=1200 --values log="Retrying /foo"
progresswatch done $TASK
```

Every update replaces the whole state, so send all of it each time; a `log` value shows as
the task's last line.

### `run`

```bash
progresswatch run "python train.py"
progresswatch run --title "Nightly training" "python train.py --epochs 100"
progresswatch run -- rsync -av /data /backup     # argv form, no shell involved
```

It reports a start and a finish, not counts, and exits with the command's exit code.

### Nesting

```bash
DEPLOY=$(progresswatch new "Deploy")
BUILD=$(progresswatch new "Build" --parent $DEPLOY)
TEST=$(progresswatch new "Test" --parent $DEPLOY)
```

One level deep. A parent's bar averages its children, but it does not finish on its own:
`done` it after the last step.

## Scripts

- stdout carries only the result: a bare UUID, or JSON with `--json`
- everything a person reads goes to stderr
- failure exits non-zero

```bash
export PROGRESSWATCH_SERVER="https://progress.watch"
export PROGRESSWATCH_SPACE="$MY_SPACE_UUID"

TOTAL=$(wc -l < urls.txt)
TASK=$(progresswatch new "Nightly crawl")
trap 'progresswatch done "$TASK" || true' EXIT

n=0
while read -r url; do
  n=$((n + 1))
  curl -sf "$url" -o "out/$n.html" || true
  if (( n % 50 == 0 )); then
    progresswatch update "$TASK" --current "$n" --end "$TOTAL"
  fi
done < urls.txt
```

```bash
progresswatch show "$TASK" --json | jq -r '.progress.ratio'
progresswatch list --json | jq -r '.tasks[] | select(.finished_at == null) | .title'
```

## Configuration

Stored at `~/.progresswatchrc`, readable only by you:

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

| | |
|---|---|
| `PROGRESSWATCH_SERVER` | server URL; overrides the per-space server, for CI |
| `PROGRESSWATCH_SPACE` | space UUID, same as `--space` |
| `PROGRESSWATCH_CONFIG` | config file path, default `~/.progresswatchrc` |

### Your own server

```bash
progresswatch configure --server https://pw.internal
progresswatch configure --list
```

It applies to spaces you create from now on; each existing space keeps the server it was
created on.

### One command, another space

```bash
progresswatch show "$TASK" --space "$OTHER_SPACE_UUID"
```

### A directory with its own space

```bash
progresswatch space new "Crawler" --local
progresswatch space use 406d45fd-... --local
progresswatch space unbind
```

### The space UUID is a credential

Anyone with it can read and write the space, and there are no accounts to recover it from:
keep it in a secret rather than a committed file, and back up `~/.progresswatchrc`.

## Pairing your phone

```bash
progresswatch connect
```

On iOS, add the page to the Home Screen to get notifications.

## Using it from an AI agent

The package ships an agent skill, so an agent reports its own long-running work into a
space:

```bash
npx skills add progress-watch/progresswatch-cli
```

An agent can also skip the CLI and use the server's [MCP endpoint](https://progress.watch/docs/mcp).

## Development

Requires Node 20 or newer.

```bash
npm install
npm run build      # esbuild -> dist/cli.js
npm test           # builds, then runs the suite against an in-process mock server
npm run typecheck

PROGRESSWATCH_E2E_SERVER=http://localhost:7979 npm run test:e2e   # the same commands against a real server
```

## License

Distributed under the [MIT](LICENSE) license.
