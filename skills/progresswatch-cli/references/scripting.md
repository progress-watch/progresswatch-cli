# Scripting

## The output contract

This is what makes the CLI usable in scripts, and it is deliberate:

- **stdout carries machine-consumable output and nothing else** — a bare uuid, or JSON under `--json`
- **everything a human reads goes to stderr**, including the `list`/`show` renderings and the QR code, so it stays visible when you capture stdout
- **non-zero exit on failure**, always

```bash
TASK=$(progresswatch new "Backup")   # exactly one uuid, no chatter
```

A read command with no `--json` writes nothing to stdout. Piping `progresswatch list`
into `grep` gets you nothing — use `--json`.

```bash
progresswatch list --json | jq -r '.tasks[] | select(.finished_at == null) | .title'
progresswatch show "$TASK" --json | jq -r '.progress.ratio'
```

## Configuration in CI

Environment variables override the config file, which is the point — CI has no
`~/.progresswatchrc`:

```bash
export PROGRESSWATCH_SERVER="https://progress.watch"
export PROGRESSWATCH_SPACE="$PROGRESSWATCH_SPACE"   # from your secret store
```

Keep the space uuid in a secret. It is the credential: whoever has it can read and write
the space, and nothing on the server can recover it if lost.

`--space <uuid>` does the same for a single command, which is how you report into a
different space without disturbing the default.

## A reporting loop

```bash
#!/usr/bin/env bash
set -euo pipefail

TOTAL=$(wc -l < urls.txt)
TASK=$(progresswatch new "Nightly crawl")

# Finish the task even if the script dies.
trap 'progresswatch done "$TASK" || true' EXIT

n=0
errors=0
while read -r url; do
  n=$((n + 1))
  curl -sf "$url" -o "out/$n.html" || errors=$((errors + 1))

  # Report every 50 URLs, not every one.
  if (( n % 50 == 0 )); then
    progresswatch update "$TASK" \
      --current "$n" --end "$TOTAL" \
      --values errors="$errors" --values log="Fetched $url"
  fi
done < urls.txt
```

Two things to copy from this: the `trap`, so a crash still closes the task and notifies;
and the modulo, so you report meaningful steps rather than every iteration.

## Wrapping instead of instrumenting

When you do not need intermediate progress, `run` is the whole integration:

```bash
progresswatch run --title "CI: integration suite" "bundle exec rspec"
```

It streams the command's stdout and stderr through untouched, so redirects behave exactly
as they would without the wrapper:

```bash
progresswatch run "python train.py" > train.log 2> train.err
```

It exits with the command's exit code, so it drops into a pipeline without changing
control flow:

```bash
progresswatch run "make build" && progresswatch run "make deploy"
```

A non-zero exit is recorded on the task as `status=failed` with the code, so the
dashboard shows what happened rather than just "finished".

## Steps in a script

```bash
DEPLOY=$(progresswatch new "Deploy $GIT_SHA")
trap 'progresswatch done "$DEPLOY" || true' EXIT

for step in build test ship; do
  STEP=$(progresswatch new "$step" --parent "$DEPLOY")
  progresswatch start "$STEP"
  if progresswatch run --title "$step" "make $step"; then
    progresswatch update "$STEP" --current 1 --end 1 --done
  else
    progresswatch update "$STEP" --values status=failed --done
    exit 1
  fi
done
```

The parent bar moves on its own as the steps finish — never update it directly.

## Long-running jobs

Progress is held in memory with an inactivity TTL, so a job that reports once and then
runs silently for a day will read as "waiting for data…" long before it finishes. Keep
reporting periodically; it both shows progress and keeps the task alive. `run` does this
for you.
