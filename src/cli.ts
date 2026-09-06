import { Command, InvalidArgumentError, Option } from 'commander'
import { ApiError } from './api.js'
import { configure } from './commands/configure.js'
import { connect } from './commands/connect.js'
import { run } from './commands/run.js'
import { spaceList, spaceNew, spaceUnbind, spaceUse } from './commands/space.js'
import { status } from './commands/status.js'
import { taskDone, taskList, taskNew, taskShow, taskStart, taskUpdate } from './commands/task.js'
import { info } from './output.js'

declare const __VERSION__: string

function number(value: string): number {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) throw new InvalidArgumentError(`expected a number, got "${value}"`)
	return parsed
}

function count(value: string): number {
	const parsed = Number(value)
	if (!Number.isInteger(parsed) || parsed < 1) throw new InvalidArgumentError(`expected a whole number of 1 or more, got "${value}"`)
	return parsed
}

function collectValues(pair: string, previous: Record<string, string | number | boolean>) {
	const index = pair.indexOf('=')
	if (index < 1) throw new InvalidArgumentError(`expected key=value, got "${pair}"`)

	const key = pair.slice(0, index)
	const raw = pair.slice(index + 1)
	const parsed =
		raw === 'true' || raw === 'false' ? raw === 'true' : raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw

	return { ...previous, [key]: parsed }
}

function examples(command: Command, lines: string[]): Command {
	return command.addHelpText('after', `\nExamples:\n${lines.map((line) => `  ${line}`).join('\n')}`)
}

function applySpace(options: { space?: string }): void {
	if (options.space) process.env.PROGRESSWATCH_SPACE = options.space
}

function spaceOption(): Option {
	return new Option('--space <uuid>', 'Act on this space for one command, instead of the default')
}

function jsonOption(what: string): Option {
	return new Option('--json', `Print ${what} as JSON on stdout`).default(false)
}

const program = new Command()
	.name('progresswatch')
	.description('Report progress from anything that runs without a screen, and watch it from anywhere.')
	.version(__VERSION__, '-v, --version')
	.enablePositionalOptions()
	.showHelpAfterError('Run with --help to see the options.')
	.configureOutput({ writeOut: (text) => process.stderr.write(text) })
	.addHelpText(
		'after',
		`
Output contract:
  stdout carries only machine-consumable output — a bare uuid, or JSON under --json.
  Everything a human reads goes to stderr, so TASK=$(progresswatch new "Backup") works.

Environment:
  PROGRESSWATCH_SERVER   server URL, overrides the one recorded for the space
  PROGRESSWATCH_SPACE    space uuid, overrides the default and any directory binding
  PROGRESSWATCH_CONFIG   config path (default ~/.progresswatchrc)`,
	)

examples(
	program
		.command('configure')
		.description('Point this machine at a server. Only needed for self-hosting; the default is the hosted service')
		.addOption(new Option('--server <url>', 'Server URL. Prompted for when omitted'))
		.addOption(new Option('--list', 'Show the current configuration instead of changing it').default(false))
		.addOption(jsonOption('the configuration'))
		.action((options: { server?: string; list: boolean; json: boolean }) =>
			configure({ server: options.server, list: options.list, asJson: options.json }),
		),
	['progresswatch configure', 'progresswatch configure --server https://pw.internal', 'progresswatch configure --list'],
)

examples(
	program
		.command('status')
		.description('Check the server the current space lives on, and say which setting chose it')
		.addOption(spaceOption())
		.addOption(jsonOption('the check'))
		.action((options: { space?: string; json: boolean }) => {
			applySpace(options)
			return status({ asJson: options.json })
		}),
	['progresswatch status', 'progresswatch status --json | jq -r .reachable'],
)

const space = program.command('space').description('Manage the spaces this machine knows about')

examples(
	space
		.command('new [title]')
		.description('Create a space, and make it the default or the space for this directory')
		.addOption(new Option('--icon <character>', 'One character shown beside the name; an emoji reads best'))
		.addOption(new Option('--local', 'Apply to the working directory instead of globally').default(false))
		.addOption(jsonOption('the space'))
		.action((title: string | undefined, options: { icon?: string; local: boolean; json: boolean }) =>
			spaceNew(title, options.icon, options.json, options.local),
		),
	['progresswatch space new "Production"', 'progresswatch space new "Crawler" --icon 🕷 --local'],
)

examples(
	space
		.command('list')
		.description('Spaces recorded on this machine. There is no endpoint for this: without accounts the server cannot know which are yours')
		.addOption(jsonOption('them'))
		.action((options: { json: boolean }) => spaceList(options.json)),
	['progresswatch space list'],
)

examples(
	space
		.command('use <uuid>')
		.description('Switch the default space, or set the space for this directory')
		.addOption(new Option('--server <url>', 'The server that uuid lives on. Needed for any space not on the default host'))
		.addOption(new Option('--local', 'Apply to the working directory instead of globally').default(false))
		.action((uuid: string, options: { server?: string; local: boolean }) => spaceUse(uuid, options.server, options.local)),
	[
		'progresswatch space use 406d45fd-f623-472a-acac-eef9b5281549',
		'progresswatch space use 406d45fd-f623-472a-acac-eef9b5281549 --server https://pw.internal',
		'progresswatch space use 406d45fd-f623-472a-acac-eef9b5281549 --local',
	],
)

space
	.command('unbind')
	.description("Remove this directory's space, so the default applies again")
	.action(() => spaceUnbind())

examples(
	program
		.command('connect')
		.description('Print a QR code and deep link for pairing a phone with the current space')
		.addOption(jsonOption('the pairing link'))
		.addOption(spaceOption())
		.action((options: { json: boolean; space?: string }) => {
			applySpace(options)
			return connect(options.json)
		}),
	['progresswatch connect'],
)

examples(
	program
		.command('new <title>')
		.description('Create a task and print its uuid. Call this when starting work someone might want to watch')
		.addOption(new Option('--parent <uuid>', 'Make this a step of an existing task. One level only'))
		.addOption(new Option('--source <name>', 'What is reporting, e.g. crawler.py'))
		.addOption(jsonOption('the task'))
		.addOption(spaceOption())
		.action((title: string, options: { parent?: string; source?: string; json: boolean; space?: string }) => {
			applySpace(options)
			return taskNew(title, { parent: options.parent, source: options.source }, options.json)
		}),
	['TASK=$(progresswatch new "Crawl docs")', 'STEP=$(progresswatch new "Fetch sitemap" --parent "$TASK")'],
)

examples(
	program
		.command('update <uuid>')
		.description('Report progress. Every call replaces the whole state, so send all of it each time')
		.addOption(new Option('--current <n>', 'How much is done. A count, never a percentage').argParser(number))
		.addOption(new Option('--end <n>', 'The total. May change between calls; omit it to count with no bar').argParser(number))
		.addOption(new Option('--values <key=value>', 'Flat extras, repeatable. A log key holds one line, the latest').argParser(collectValues).default({}))
		.addOption(new Option('--done', 'Finish the task in the same call').default(false))
		.addOption(jsonOption('the task'))
		.addOption(spaceOption())
		.action(
			(
				uuid: string,
				options: {
					current?: number
					end?: number
					values: Record<string, string | number | boolean>
					done: boolean
					json: boolean
					space?: string
				},
			) => {
				applySpace(options)
				return taskUpdate(
					uuid,
					{ current: options.current, end: options.end, values: options.values, done: options.done || undefined },
					options.json,
				)
			},
		),
	[
		'progresswatch update "$TASK" --current 1200 --end 50000',
		'progresswatch update "$TASK" --current 1200 --end 50000 --values pages=1200 --values errors=3',
		'progresswatch update "$TASK" --values status=failed --values log="exit 1 on step 3" --done',
	],
)

examples(
	program
		.command('start <uuid>')
		.description('Mark a task running before it can count anything. Without it the task reads as "waiting", which looks the same as a reporter that died')
		.addOption(jsonOption('the task'))
		.addOption(spaceOption())
		.action((uuid: string, options: { json: boolean; space?: string }) => {
			applySpace(options)
			return taskStart(uuid, options.json)
		}),
	['progresswatch start "$STEP"'],
)

examples(
	program
		.command('done <uuid>')
		.description('Finish a task. This is what sends the notification, so call it for a failure too')
		.addOption(jsonOption('the task'))
		.addOption(spaceOption())
		.action((uuid: string, options: { json: boolean; space?: string }) => {
			applySpace(options)
			return taskDone(uuid, options.json)
		}),
	['progresswatch done "$TASK"'],
)

examples(
	program
		.command('list')
		.description('Tasks in the current space, with their progress')
		.addOption(new Option('--limit <count>', 'How many to show. Unfinished first, then the newest finished. 20 by default, all with --json').argParser(count))
		.addOption(new Option('--before <timestamp>', 'Only tasks created before this instant. Page back with a created_at'))
		.addOption(new Option('--after <timestamp>', 'Only tasks created after this instant. What is new since a created_at'))
		.addOption(jsonOption('the space and its tasks'))
		.addOption(spaceOption())
		.action((options: { json: boolean; space?: string; limit?: number; before?: string; after?: string }) => {
			applySpace(options)
			return taskList(options.json, { limit: options.limit, before: options.before, after: options.after })
		}),
	[
		'progresswatch list',
		'progresswatch list --limit 5',
		'progresswatch list --after 2026-08-16T18:12:01.999158Z',
		"progresswatch list --json | jq -r '.tasks[] | select(.finished_at == null) | .title'",
	],
)

examples(
	program
		.command('show <uuid>')
		.description('One task with its steps')
		.addOption(jsonOption('the task'))
		.addOption(spaceOption())
		.action((uuid: string, options: { json: boolean; space?: string }) => {
			applySpace(options)
			return taskShow(uuid, options.json)
		}),
	['progresswatch show "$TASK"', 'progresswatch show "$TASK" --json | jq -r .progress.ratio'],
)

// passThroughOptions so flags after the command belong to the child: without it
// `progresswatch run "rsync -av src dst"` would have commander claim -a and -v.
examples(
	program
		.command('run <command...>')
		.description('Run a command, track it from start to finish, and exit with its status')
		.passThroughOptions()
		.addOption(new Option('--title <title>', 'Task title. Defaults to the command itself'))
		.addOption(new Option('--parent <uuid>', 'Make this a step of an existing task'))
		.addOption(spaceOption())
		.action((command: string[], options: { title?: string; parent?: string; space?: string }) => {
			applySpace(options)
			return run(command, { title: options.title, parent: options.parent })
		}),
	['progresswatch run "python train.py"', 'progresswatch run --title "Nightly backup" restic backup /data'],
)

program.parseAsync().catch((error: unknown) => {
	const message = error instanceof ApiError || error instanceof Error ? error.message : String(error)
	info(`progresswatch: ${message}`)
	process.exit(1)
})
