# Commands

Global options, accepted on every command:

| Option | Description |
|---|---|
| `--space <uuid>` | Act on this space instead of the default, for one invocation. Same effect as `PROGRESSWATCH_SPACE` |
| `--json` | Machine-readable output on stdout for read commands |
| `-v, --version` | Print the version |
| `-h, --help` | Print usage |

---

## `progresswatch configure`

Point this machine at a server. Only needed for self-hosting — without it everything goes
to `https://progress.watch`.

| Option | Description |
|---|---|
| `--server <url>` | Server URL. Prompted for when omitted |
| `--list` | Print the configuration in effect instead of changing it |
| `--json` | With `--list`, print it as JSON on stdout |

```bash
progresswatch configure --server https://pw.internal
progresswatch configure --list
```

The server is checked before it is saved: `/up` has to answer, and answer that its
database and Redis are both up. A URL that cannot be reached is refused and nothing is
written, because a config pointing at the wrong host fails later and further away.

**It sets the server for spaces created from now on, and moves nothing.** Each space
records the server it was created against, so a machine can watch a hosted space and two
self-hosted ones at the same time. That is also why a directory binding needs no server of
its own: it points at a space, and the space carries the host.

`--list` names the environment variable when one is deciding:

```
Server:    https://pw.internal  (from PROGRESSWATCH_SERVER)
Default:   406d45fd-f623-472a-acac-eef9b5281549
Here:      8a320d2a-1ed9-4b6b-8cc8-e9295e964a53
Spaces:    3
Config:    ~/.progresswatchrc
```

---

## `progresswatch space new`

Create a space, record it locally, and make it the default.

| Argument | Description |
|---|---|
| `[title]` | Optional name. Shown on the dashboard and in notifications |

Prints the bare uuid on stdout.

```bash
progresswatch space new
progresswatch space new "Production crawlers"
SPACE=$(progresswatch space new "CI")
```

---

## `progresswatch space list`

Spaces this machine knows about. There is no server-side list — without accounts the
server cannot know which spaces are yours, so this reads `~/.progresswatchrc` only.

```bash
progresswatch space list
progresswatch space list --json
```

---

## `progresswatch space use`

Switch the default space, and add it if this machine has never seen it.

| Argument | Description |
|---|---|
| `<uuid>` | Space uuid. May be one this machine has never seen — someone shared it |
| `--server <url>` | The server that uuid lives on. Recorded against the space |
| `--local` | Set this space for the working directory instead of globally. `--global` is the default and may be passed for symmetry |

```bash
progresswatch space use 406d45fd-f623-472a-acac-eef9b5281549
progresswatch space use 406d45fd-f623-472a-acac-eef9b5281549 --server https://pw.internal
```

**Pass `--server` for any space that is not on the default host.** Without it the entry
is filed under the default, and every later command addressed by task uuid then talks to
a server that has never heard of it. Passing it for a space that already exists corrects
the one on file.

### A space for one directory

```bash
cd ~/code/crawler
progresswatch space new "Crawler" --local
```

Creates it and applies it here, without disturbing the global default. For a space that
already exists, `space use` takes the same flag:

```bash
progresswatch space use 406d45fd-f623-472a-acac-eef9b5281549 --local
```

Everything run from that directory or below it now reports into that space, whatever the
default is. The deepest binding wins, so a subdirectory can override the repository above
it, and `progresswatch space unbind` removes one.

Bindings live in `~/.progresswatchrc` under `paths`, keyed by absolute directory — the
same idea as git's `includeIf "gitdir:"`, and for the same reason: a uuid is a credential,
so it stays in one file with owner-only permissions rather than in a file inside a project
that gets committed by accident.

Resolution order, highest first:

```
--space <uuid>
PROGRESSWATCH_SPACE      so CI is never second-guessed by a checkout path
the deepest directory binding
the default space
```

---

## `progresswatch space unbind`

Removes the binding on the working directory, if there is one. The default space applies
again. Nothing else is touched.

---

## `progresswatch connect`

Print a QR code and a link to the space, for opening it on a phone. The QR goes to
stderr; the link goes to stdout so it can be captured.

It is an ordinary `https://` link to the space page, not a custom URL scheme: the phone
client is the web app, so it has to work with nothing installed. Opening the page is also
what records the space on that device, which is the same mechanism the web UI uses.

The link carries its own host, so this works for a self-hosted server without anything
being configured on the phone. To get notifications there, add the page to the home
screen — on iOS that is a requirement, not a nicety.

```bash
progresswatch connect
progresswatch connect --json
LINK=$(progresswatch connect 2>/dev/null)
```

---

## `progresswatch new`

Create a task. Prints the bare uuid on stdout and nothing else.

| Option | Description |
|---|---|
| `<title>` | Required. What the task is doing |
| `--parent <uuid>` | Make this a step of an existing top-level task. One level only |
| `--source <value>` | What is reporting, e.g. `crawler.py`. Defaults to `progresswatch-cli` |

```bash
TASK=$(progresswatch new "Nightly crawl")
BUILD=$(progresswatch new "Build" --parent "$DEPLOY")
progresswatch new "Import" --source etl-worker
```

---

## `progresswatch update`

Report progress. **Replaces the whole state** — see [reporting.md](reporting.md).

| Option | Description |
|---|---|
| `<uuid>` | Required. Task uuid |
| `--current <n>` | How much is done. A number, not a percentage |
| `--end <n>` | How much there is in total. May change between calls |
| `--values k=v` | Repeatable. Numbers and `true`/`false` are sent as real types, everything else as a string |
| `--done` | Finish the task in the same call |

```bash
progresswatch update "$TASK" --current 1200 --end 50000
progresswatch update "$TASK" --current 1200 --end 50000 \
  --values pages=1200 --values errors=3 --values log="Timeout on /foo, retrying"
progresswatch update "$TASK" --current 50000 --end 50000 --done
```

A `log` value is rendered as the task's last line. It holds one line, not a history.

---

## `progresswatch start`

Mark a task as running before it can count anything. Sends `current: 0, end: 1`.

| Argument | Description |
|---|---|
| `<uuid>` | Required. Task uuid |

```bash
progresswatch start "$TASK"
```

Without it a created task reads as "waiting for data", which looks the same as a reporter
that never got going.

---

## `progresswatch done`

Mark a task finished. This is what sends the push notification.

| Argument | Description |
|---|---|
| `<uuid>` | Required. Task uuid |

```bash
progresswatch done "$TASK"
```

Finishing is one-way. Reporting afterwards still overwrites progress, but the finish
time does not move and no second notification is sent.

---

## `progresswatch list`

Every task in the default space, children nested under parents.

```bash
progresswatch list
progresswatch list --json
progresswatch list --space "$OTHER_SPACE"
```

---

## `progresswatch show`

One task with its children.

| Argument | Description |
|---|---|
| `<uuid>` | Required. Task uuid |

```bash
progresswatch show "$TASK"
progresswatch show "$TASK" --json
```

---

## `progresswatch run`

Create a task, run a command, stream its output through untouched, and finish the task
on exit. The most direct way to get a notification when something completes.

| Option | Description |
|---|---|
| `<command>` | Required. One quoted string runs through your shell; several arguments are spawned directly with no shell |
| `--title <value>` | Task title. Defaults to the command line itself |
| `--parent <uuid>` | Make this a step of an existing task |

```bash
progresswatch run "python train.py"
progresswatch run --title "Nightly training" "python train.py --epochs 100"
progresswatch run -- rsync -av /data /backup
```

Exits with the wrapped command's exit code. A non-zero exit is recorded on the task as
`status=failed` with the code. While the command runs the task is refreshed
periodically, so it does not fall off the server's inactivity timeout.

If the task cannot be created — server down, wrong space — `run` fails without starting
your command, rather than running it untracked. Once running, a failed progress report
is logged and the command carries on.
