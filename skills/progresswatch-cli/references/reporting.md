# What the numbers mean

## Counts, not percentages

Progress is `current` out of `end`. The client computes the percentage and shows both,
because `1200 / 50000 pages` tells someone something that `2.4%` does not.

`end` may change between calls. A crawler that discovers more URLs sends a bigger number
and the bar recalculates — that is expected, not a correction.

```bash
progresswatch update "$TASK" --current 1200 --end 50000
progresswatch update "$TASK" --current 1200 --end 92000   # found more work
```

## Every write replaces the whole state

This is the rule most likely to surprise you. A write is not a patch: whatever you leave
out is **cleared**, not preserved.

```bash
progresswatch update "$TASK" --current 10 --end 100 --values pages=10 --values errors=3
progresswatch update "$TASK" --current 20 --end 100
# values is now {} — not {pages: 10, errors: 3}
```

Send your complete state every time. The process doing the work always knows it, so this
is simpler than tracking what was already sent — and one call fully restores a task after
a server restart.

## `values`

A flat object of extra numbers and strings. The client decides how to render each key.

```bash
--values pages=1200 --values errors=3 --values rate="45/s" --values stalled=false
```

Numbers and `true`/`false` are sent as real types; everything else is a string. Nesting
is rejected — the object must be flat.

A `log` key is special only by convention: clients render it as the task's last line. It
holds **one line**, the latest. There is no log history and never will be.

## Steps

Nesting is exactly one level. A task is either top-level or a step of one; a step cannot
have steps of its own, and `--parent` pointing at a step is rejected.

```bash
DEPLOY=$(progresswatch new "Deploy")
BUILD=$(progresswatch new "Build" --parent "$DEPLOY")
TEST=$(progresswatch new "Test" --parent "$DEPLOY")
```

**A parent's progress is derived from its children — never update a parent directly.**
Its bar is the mean of its children's ratios, and its raw numbers count finished children
out of total ("2 of 5 steps"). Any `current`/`end` you report on a parent is ignored,
though its `values` still come through, so a parent can carry a log line of its own.

A step that has reported nothing counts as zero — it has not started. A step that
finished counts as complete even if the server has since forgotten its numbers.

## When each call happens

The shape of a report is easy. The timing is what decides whether it is worth anything.

**Build the tree before the work starts.** Tasks created as the job ends describe it
accurately and too late — the whole point is that someone can watch it while it runs.

**Finish each step in the same breath as the work that finishes it.** The failure this
prevents is specific and extremely common, because the wrong way is cheaper for the
reporter: create every step up front, do the work, then send every `done` in one block at
the end. Measured across 27 runs of an agent doing exactly that, the median gap between
sibling completions was **zero seconds**, in runs lasting several minutes. The board sat
empty for the whole job and turned green after it.

```bash
progresswatch start "$BUILD"
npm run build && progresswatch done "$BUILD"

progresswatch start "$TEST"
npm test && progresswatch done "$TEST"
```

The same applies to the size of the work. A step that takes ten seconds is still a step,
and deciding case by case whether something is worth reporting is how a reporter drifts
into reporting nothing.

**And the tree keeps growing.** Work that nobody foresaw is the normal case: a fix the
change turned up, a check you decided to run, a dependency that had to be updated first.
Each of those is a step, created when it appears — not folded into whichever step is open
because the tree was already drawn.

```bash
LINT=$(progresswatch new "Fix the lint the refactor exposed" --parent "$DEPLOY")
progresswatch start "$LINT"
```

A parent gaining a step pulls its bar backwards: its numbers are finished children out of
total, and its ratio is the mean of theirs, so a step that lands at zero lowers both. That
is the same honesty as `end` growing when a crawler discovers more URLs — the work really
did get bigger, and a bar that only ever moves forward would be hiding it.

## Three states that look alike

Read output distinguishes three things that are easy to confuse:

| What you see | What it means |
|---|---|
| `waiting for data…` | The task exists but has never reported. Not zero — nothing has arrived |
| an empty bar at `0.0%` | The process reported zero. Work has started, nothing is done |
| `—` / `? %` | `end` is zero or missing, so there is no usable denominator |

In `--json`, those are `progress: null`, `progress.current: 0`, and `progress.ratio: null`
respectively.

The first two look alike on a dashboard and mean opposite things, and the difference is
yours to send. A task that has been created and never reported is indistinguishable from a
reporter that died before its first write. **Say when a step begins**, even when there is
nothing to count:

```bash
progresswatch start "$STEP"
```

That is `--current 0 --end 1`: an empty bar, marked running. It is the only honest signal a
step without a numerator has, and without it the dashboard shows nothing at all until the
step finishes.

## Progress is not durable

Progress lives in memory on the server with a TTL, and is never written to its database.
It can expire, be flushed, or disappear on a restart. When that happens the task keeps
its title, its parent and its steps, and reads back as "waiting for data…" until the next
write restores everything.

This is normal and is why a long-running reporter should keep reporting: it both shows
progress and keeps the task alive.

## Completion

A task completes when `current` reaches `end` (with `end` greater than zero), or when you
run `done` / pass `--done`. Completing sends the push notification.

An `end` of zero or missing means the denominator is unknown, so nothing can be concluded
and the task will not auto-complete. Finish it explicitly.

Completion is one-way. Reporting afterwards still overwrites progress, but the finish time
does not move and no second notification is sent.

Finish tasks that failed, too — the server has no concept of failure, so record it in
`values` and finish:

```bash
progresswatch update "$TASK" --values status=failed --values log="exit 1 on step 3" --done
```
