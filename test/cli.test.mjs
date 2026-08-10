import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startMockServer } from './mock-server.mjs'

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))

let server
let home

before(async () => {
	server = await startMockServer()
	home = mkdtempSync(join(tmpdir(), 'pw-test-'))
})

after(async () => {
	await server.close()
	rmSync(home, { recursive: true, force: true })
})

// Spawns the built binary rather than importing it, which is the only way the
// stream split and exit codes are tested for real.
function cli(args, options = {}) {
	return new Promise((resolve) => {
		const env = {
			...process.env,
			PROGRESSWATCH_SERVER: options.server ?? server.url,
			PROGRESSWATCH_CONFIG: options.config ?? join(home, 'rc.json'),
			...options.env,
		}

		// PROGRESSWATCH_SERVER overrides per-space servers, so tests about per-space
		// resolution have to run without it.
		if (options.noServerEnv) delete env.PROGRESSWATCH_SERVER

		const child = spawn(process.execPath, [CLI, ...args], { env, cwd: options.cwd })

		let stdout = ''
		let stderr = ''
		child.stdout.on('data', (d) => {
			stdout += d
		})
		child.stderr.on('data', (d) => {
			stderr += d
		})
		child.on('close', (code) => resolve({ code, stdout, stderr }))
	})
}

async function freshSpace() {
	const config = join(mkdtempSync(join(tmpdir(), 'pw-space-')), 'rc.json')
	const created = await cli(['space', 'new', 'Test space'], { config })
	return { config, space: created.stdout.trim() }
}

describe('scriptability', () => {
	test('space new prints the bare uuid to stdout', async () => {
		const { stdout, stderr, code } = await cli(['space', 'new', 'Production'])

		assert.equal(code, 0)
		assert.match(stdout.trim(), /^[0-9a-f-]{36}$/)
		assert.match(stderr, /Created space/)
	})

	test('space new prints the watch link beside the uuid', async () => {
		const { stdout, stderr } = await cli(['space', 'new', 'Production'])

		assert.match(stderr, new RegExp(`/s/${stdout.trim()}`))
		assert.doesNotMatch(stdout, /\/s\//)
	})

	// Adding a shared uuid is the whole reason --server exists: without it a self-hosted
	// space is filed under the default host and every later command talks to the wrong
	// machine. Run without PROGRESSWATCH_SERVER so the flag is the only thing deciding.
	test('space use records the server it was told, not the default', async () => {
		const config = join(mkdtempSync(join(tmpdir(), 'pw-use-')), 'rc.json')
		const uuid = '00000000-1111-2222-3333-444444444444'

		const { code, stderr } = await cli(['space', 'use', uuid, '--server', server.url], {
			config,
			noServerEnv: true,
		})

		assert.equal(code, 0)
		assert.match(stderr, new RegExp(server.url))

		const entry = JSON.parse(readFileSync(config, 'utf8')).spaces.find((s) => s.uuid === uuid)
		assert.equal(entry.server, server.url)
	})

	test('start moves a task off waiting without inventing a count', async () => {
		const { config } = await freshSpace()
		const task = (await cli(['new', 'A step'], { config })).stdout.trim()

		const waiting = JSON.parse((await cli(['show', task, '--json'], { config })).stdout)
		assert.equal(waiting.progress, null)

		const { code } = await cli(['start', task], { config })
		assert.equal(code, 0)

		const running = JSON.parse((await cli(['show', task, '--json'], { config })).stdout)
		assert.equal(running.progress.current, 0)
		assert.equal(running.progress.end, 1)
		assert.equal(running.finished_at, null)
	})

	test('new prints the bare uuid to stdout and nothing else', async () => {
		const { config } = await freshSpace()
		const { stdout, stderr, code } = await cli(['new', 'Backup'], { config })

		assert.equal(code, 0)
		assert.match(stdout.trim(), /^[0-9a-f-]{36}$/)
		assert.equal(stdout.trim().split('\n').length, 1)
		assert.match(stderr, /Created task/)
	})

	test('human-facing output for read commands stays off stdout', async () => {
		const { config } = await freshSpace()
		await cli(['new', 'Backup'], { config })

		const { stdout, stderr } = await cli(['list'], { config })

		assert.equal(stdout, '')
		assert.match(stderr, /Backup/)
	})

	test('--json puts machine-readable output on stdout', async () => {
		const { config } = await freshSpace()
		await cli(['new', 'Backup'], { config })

		const { stdout, code } = await cli(['list', '--json'], { config })

		assert.equal(code, 0)
		const parsed = JSON.parse(stdout)
		assert.equal(parsed.tasks.length, 1)
		assert.equal(parsed.tasks[0].title, 'Backup')
	})

	test('lists the newest first, and what is still running above what is finished', async () => {
		const { config } = await freshSpace()
		const first = (await cli(['new', 'First'], { config })).stdout.trim()
		await cli(['new', 'Second'], { config })
		const third = (await cli(['new', 'Third'], { config })).stdout.trim()
		await cli(['done', first], { config })
		await cli(['done', third], { config })

		const { stdout, stderr } = await cli(['list'], { config })

		assert.equal(stdout, '')
		const order = ['Second', 'Third', 'First'].map((title) => stderr.indexOf(title))
		assert.ok(order.every((at) => at !== -1), stderr)
		assert.deepEqual(order, [...order].sort((a, b) => a - b), stderr)
	})

	test('exits non-zero when the server rejects the request', async () => {
		const { config } = await freshSpace()
		const { code, stderr } = await cli(['show', 'does-not-exist'], { config })

		assert.equal(code, 1)
		assert.match(stderr, /Task not found/)
	})

	test('exits non-zero with a clear message when the server is unreachable', async () => {
		const { code, stderr } = await cli(['list'], {
			server: 'http://127.0.0.1:1',
			env: { PROGRESSWATCH_SPACE: 'whatever' },
		})

		assert.equal(code, 1)
		assert.match(stderr, /cannot reach http:\/\/127\.0\.0\.1:1/)
	})

	test('says which server a task command actually looked on', async () => {
		const { config } = await freshSpace()
		const { code, stderr } = await cli(['done', 'a-task-from-somewhere-else'], { config })

		assert.equal(code, 1)
		assert.match(stderr, /does not carry a server of its own/)
		assert.match(stderr, /--space <uuid>/)
	})

	test('exits non-zero when no space is configured', async () => {
		const config = join(mkdtempSync(join(tmpdir(), 'pw-empty-')), 'rc.json')
		const { code, stderr } = await cli(['list'], { config, env: { PROGRESSWATCH_SPACE: '' } })

		assert.equal(code, 1)
		assert.match(stderr, /no space selected/)
	})
})

describe('config', () => {
	test('is written with owner-only permissions, since the uuid is a credential', async () => {
		const { config } = await freshSpace()

		assert.equal(statSync(config).mode & 0o777, 0o600)
	})

	test('records the resolved server per space rather than a live reference', async () => {
		const { config } = await freshSpace()
		const written = JSON.parse(readFileSync(config, 'utf8'))

		assert.equal(written.spaces[0].server, server.url)
		assert.equal(written.space, written.spaces[0].uuid)
	})

	test('PROGRESSWATCH_SPACE overrides the config file', async () => {
		const { config, space } = await freshSpace()
		const other = await freshSpace()

		const { stdout } = await cli(['list', '--json'], {
			config,
			env: { PROGRESSWATCH_SPACE: other.space },
		})

		assert.equal(JSON.parse(stdout).uuid, other.space)
		assert.notEqual(other.space, space)
	})

	// The point of storing a server per space: one cloud space and two self-hosted ones
	// at the same time has to be normal, not a mode switch.
	test('reaches each space on its own server, with no global setting involved', async () => {
		const elsewhere = await startMockServer()
		const config = join(mkdtempSync(join(tmpdir(), 'pw-multi-')), 'rc.json')

		const here = (await cli(['space', 'new', 'Cloud'], { config })).stdout.trim()
		const there = (await cli(['space', 'new', 'Self-hosted'], { config, server: elsewhere.url })).stdout.trim()
		await cli(['space', 'use', here], { config, noServerEnv: true })

		const before = elsewhere.requests.length
		const task = (await cli(['new', 'Over there', '--space', there], { config, noServerEnv: true })).stdout.trim()

		// Created on the other server even though the default space is the first one.
		assert.ok(elsewhere.requests.length > before)
		assert.ok(elsewhere.tasks.has(task))
		assert.ok(!server.tasks.has(task))

		// And a task command directed at that space follows it there too.
		await cli(['update', task, '--current', '5', '--end', '10', '--space', there], {
			config,
			noServerEnv: true,
		})
		assert.equal(elsewhere.state.get(task).current, 5)

		await elsewhere.close()
	})

	test('a task command refuses to guess a server when no space is selected', async () => {
		const config = join(mkdtempSync(join(tmpdir(), 'pw-nospace-')), 'rc.json')

		const { code, stderr } = await cli(['show', 'some-task'], {
			config,
			noServerEnv: true,
			env: { PROGRESSWATCH_SPACE: '' },
		})

		assert.equal(code, 1)
		assert.match(stderr, /no space selected/)
	})

	test('space use switches the default', async () => {
		const { config } = await freshSpace()
		const other = await freshSpace()

		await cli(['space', 'use', other.space], { config })
		const { stdout } = await cli(['list', '--json'], { config })

		assert.equal(JSON.parse(stdout).uuid, other.space)
	})
})

describe('update', () => {
	test('sends current, end and typed values', async () => {
		const { config } = await freshSpace()
		const task = (await cli(['new', 'Crawl'], { config })).stdout.trim()

		await cli(
			['update', task, '--current', '1200', '--end', '50000', '--values', 'pages=1200', '--values', 'log=working', '--values', 'stalled=false'],
			{ config },
		)

		const sent = server.requests.filter((r) => r.method === 'PUT' && r.url === `/tasks/${task}`).pop()
		assert.equal(sent.payload.current, 1200)
		assert.equal(sent.payload.end, 50000)
		assert.deepEqual(sent.payload.values, { pages: 1200, log: 'working', stalled: false })
	})

	test('rejects a non-numeric --current before sending anything', async () => {
		const { config } = await freshSpace()
		const task = (await cli(['new', 'Crawl'], { config })).stdout.trim()
		const before = server.requests.length

		const { code, stderr } = await cli(['update', task, '--current', 'soon'], { config })

		assert.equal(code, 1)
		assert.match(stderr, /option '--current <n>' argument 'soon' is invalid/)
		assert.equal(server.requests.length, before)
	})

	test('rejects malformed --values', async () => {
		const { config } = await freshSpace()
		const task = (await cli(['new', 'Crawl'], { config })).stdout.trim()

		const { code, stderr } = await cli(['update', task, '--values', 'nope'], { config })

		assert.equal(code, 1)
		assert.match(stderr, /key=value/)
	})

	test('done marks the task finished', async () => {
		const { config } = await freshSpace()
		const task = (await cli(['new', 'Crawl'], { config })).stdout.trim()

		await cli(['done', task], { config })

		assert.ok(server.tasks.get(task).finished_at)
	})
})

describe('rendering', () => {
	test('shows waiting for data rather than zero when nothing has been reported', async () => {
		const { config } = await freshSpace()
		const task = (await cli(['new', 'Silent'], { config })).stdout.trim()

		const { stderr } = await cli(['show', task], { config })

		assert.match(stderr, /waiting for data/)
		assert.doesNotMatch(stderr, /0\.0%/)
	})

	test('shows an empty bar at zero, which is a different thing', async () => {
		const { config } = await freshSpace()
		const task = (await cli(['new', 'Starting'], { config })).stdout.trim()
		await cli(['update', task, '--current', '0', '--end', '100'], { config })

		const { stderr } = await cli(['show', task], { config })

		assert.match(stderr, /0\.0%/)
		assert.doesNotMatch(stderr, /waiting for data/)
	})

	test('nests children under their parent', async () => {
		const { config } = await freshSpace()
		const parent = (await cli(['new', 'Deploy'], { config })).stdout.trim()
		await cli(['new', 'Build', '--parent', parent], { config })

		const { stderr } = await cli(['show', parent], { config })

		assert.match(stderr, /Deploy/)
		assert.match(stderr, /\n\s{4,}Build/)
	})

	test('surfaces the server error when nesting two levels deep', async () => {
		const { config } = await freshSpace()
		const parent = (await cli(['new', 'Deploy'], { config })).stdout.trim()
		const child = (await cli(['new', 'Build', '--parent', parent], { config })).stdout.trim()

		const { code, stderr } = await cli(['new', 'Compile', '--parent', child], { config })

		assert.equal(code, 1)
		assert.match(stderr, /one level only/)
	})
})

// The one command that answers rather than throws: "no space selected" is the diagnosis,
// so it prints it and then carries it in the exit code.
describe('status', () => {
	test('reports the space, its server, and the health of that server', async () => {
		const { code, stderr } = await cli(['status'])

		assert.equal(code, 0)
		assert.match(stderr, /Server: {4}/)
		assert.match(stderr, /Health: {4}ok {2}\(database ok, redis ok\)/)
	})

	test('names the environment variable when one is doing the deciding', async () => {
		const { stderr } = await cli(['status'])

		assert.match(stderr, /\(from PROGRESSWATCH_SERVER\)/)
	})

	test('says so and exits non-zero when nothing is selected', async () => {
		const config = join(mkdtempSync(join(tmpdir(), 'pw-status-')), 'rc.json')

		const { code, stdout, stderr } = await cli(['status'], { config, noServerEnv: true })

		assert.equal(code, 1)
		assert.equal(stdout, '')
		assert.match(stderr, /none selected/)
	})

	test('exits non-zero when the server does not answer, and names it', async () => {
		const { code, stderr } = await cli(['status'], { server: 'http://127.0.0.1:1' })

		assert.equal(code, 1)
		assert.match(stderr, /unreachable/)
		assert.match(stderr, /127\.0\.0\.1:1/)
	})

	test('puts the machine-readable answer on stdout under --json', async () => {
		const { code, stdout } = await cli(['status', '--json'])

		assert.equal(code, 0)
		assert.equal(JSON.parse(stdout).reachable, true)
	})
})

// Self-hosting is the reason this exists: without it the only ways to reach another
// server are an environment variable or --server on every space.
describe('configure', () => {
	// A self-hoster who runs `space new` first creates the space in the cloud and finds
	// out when the dashboard stays empty, so configure is named before it.
	test('the no-space error offers configure before creating anything', async () => {
		const config = join(mkdtempSync(join(tmpdir(), 'pw-empty-')), 'rc.json')

		const { code, stderr } = await cli(['new', 'Anything'], { config, noServerEnv: true })

		assert.equal(code, 1)
		assert.match(stderr, /Self-hosting\?\s+progresswatch configure --server/)
		assert.ok(stderr.indexOf('configure') < stderr.indexOf('space new'))
	})

	test('records the server after checking it answers', async () => {
		const config = join(mkdtempSync(join(tmpdir(), 'pw-conf-')), 'rc.json')

		const { code, stderr } = await cli(['configure', '--server', server.url], { config, noServerEnv: true })

		assert.equal(code, 0)
		assert.match(stderr, /New spaces will be created on/)
		assert.equal(JSON.parse(readFileSync(config, 'utf8')).server, server.url)
	})

	test('refuses a server it cannot reach, and writes nothing', async () => {
		const config = join(mkdtempSync(join(tmpdir(), 'pw-conf-')), 'rc.json')

		const { code, stderr } = await cli(['configure', '--server', 'http://127.0.0.1:1'], {
			config,
			noServerEnv: true,
		})

		assert.equal(code, 1)
		assert.match(stderr, /cannot reach/)
		assert.throws(() => readFileSync(config, 'utf8'))
	})

	// "Why is it talking to the wrong host" is almost always a variable nobody remembers
	// exporting, so the listing names it.
	test('--list says when an environment variable is doing the deciding', async () => {
		const { config } = await freshSpace()

		const plain = await cli(['configure', '--list'], { config, noServerEnv: true })
		const overridden = await cli(['configure', '--list'], { config })

		assert.doesNotMatch(plain.stderr, /PROGRESSWATCH_SERVER/)
		assert.match(overridden.stderr, /from PROGRESSWATCH_SERVER/)
	})
})

describe('connect', () => {
	// An https link and not a custom scheme: the phone client is the web app, so this has
	// to open with nothing installed.
	test('prints a link to the space on its own server', async () => {
		const { config, space } = await freshSpace()

		const { stdout, stderr, code } = await cli(['connect'], { config })

		assert.equal(code, 0)
		assert.equal(stdout.trim(), `${server.url}/s/${space}`)
		assert.match(stderr, /█|▄|▀/)
	})
})

describe('run', () => {
	test('streams the command output through and marks the task done', async () => {
		const { config } = await freshSpace()

		const { stdout, stderr, code } = await cli(['run', 'echo hello from the child'], { config })

		assert.equal(code, 0)
		assert.equal(stdout.trim(), 'hello from the child')
		assert.match(stderr, /tracking "echo hello from the child"/)
		assert.match(stderr, /finished in/)

		const task = [...server.tasks.values()].find((t) => t.title === 'echo hello from the child')
		assert.ok(task.finished_at)
		assert.equal(server.state.get(task.uuid).values.status, 'succeeded')
	})

	test('passes the child stderr through untouched', async () => {
		const { config } = await freshSpace()

		const { stderr } = await cli(['run', 'echo oops >&2'], { config })

		assert.match(stderr, /oops/)
	})

	test('exits with the command exit code and records the failure', async () => {
		const { config } = await freshSpace()

		const { code, stderr } = await cli(['run', 'exit 3'], { config })

		assert.equal(code, 3)
		assert.match(stderr, /failed with code 3/)

		const task = [...server.tasks.values()].find((t) => t.title === 'exit 3')
		const values = server.state.get(task.uuid).values
		assert.equal(values.status, 'failed')
		assert.equal(values.exit_code, 3)
		// The server has no concept of failure, so a failed run is still "done".
		assert.ok(task.finished_at)
	})

	test('accepts an argv vector with no shell in between', async () => {
		const { config } = await freshSpace()

		const { stdout, code } = await cli(['run', '--title', 'Direct', 'echo', 'no shell here'], { config })

		assert.equal(code, 0)
		assert.equal(stdout.trim(), 'no shell here')
		assert.ok([...server.tasks.values()].some((t) => t.title === 'Direct'))
	})

	test('reports a task before the command finishes, so it is visible while running', async () => {
		const { config } = await freshSpace()

		await cli(['run', 'true'], { config })

		const task = [...server.tasks.values()].find((t) => t.title === 'true')
		const puts = server.requests.filter((r) => r.method === 'PUT' && r.url === `/tasks/${task.uuid}`)
		assert.equal(puts.length, 2)
		assert.equal(puts[0].payload.values.status, 'running')
		assert.equal(puts[1].payload.done, true)
	})

	// Deliberate: a six-hour job that reports nowhere is worse than failing now.
	test('refuses to start the command if the task cannot be created', async () => {
		const { code, stdout, stderr } = await cli(['run', 'echo survived'], {
			server: 'http://127.0.0.1:1',
			env: { PROGRESSWATCH_SPACE: 'some-space' },
		})

		assert.equal(code, 1)
		assert.match(stderr, /cannot reach/)
		assert.equal(stdout, '')
	})

	// The opposite rule once it is running.
	test('keeps going when a progress report fails mid-run', async () => {
		const { config } = await freshSpace()
		const task = (await cli(['new', 'placeholder'], { config })).stdout.trim()
		assert.ok(task)

		const { code, stdout } = await cli(['run', 'echo still here'], { config })

		assert.equal(code, 0)
		assert.equal(stdout.trim(), 'still here')
	})

	test('needs a command', async () => {
		const { config } = await freshSpace()
		const { code, stderr } = await cli(['run'], { config })

		assert.equal(code, 1)
		assert.match(stderr, /missing required argument 'command'/)
	})

	test('keeps trying to close the task, and says so when it never could', async (t) => {
		t.after(() => server.failWhen(null))
		const { config } = await freshSpace()

		server.failWhen(({ payload }) => payload.done && 503)
		const { code, stdout, stderr } = await cli(['run', 'echo done anyway'], { config })

		assert.equal(code, 0)
		assert.equal(stdout.trim(), 'done anyway')
		assert.match(stderr, /stays open until its data expires/)

		const task = [...server.tasks.values()].find((t) => t.title === 'echo done anyway')
		assert.equal(task.finished_at, null)
	})
})

describe('retry', () => {
	test('survives a server that fails twice before answering', async (t) => {
		t.after(() => server.failWhen(null))
		const { config } = await freshSpace()
		const task = (await cli(['new', 'Backup'], { config })).stdout.trim()

		let seen = 0
		server.failWhen(({ method }) => method === 'PUT' && seen++ < 2 && 503)
		const { code } = await cli(['update', task, '--current', '5', '--end', '10'], { config })

		assert.equal(code, 0)
		assert.equal(server.state.get(task).current, 5)
	})

	test('does not retry a 4xx', async (t) => {
		t.after(() => server.failWhen(null))
		const { config } = await freshSpace()
		const task = (await cli(['new', 'Backup'], { config })).stdout.trim()

		server.failWhen(({ method }) => method === 'PUT' && 422)
		const before = server.requests.length
		const { code } = await cli(['update', task, '--current', '5', '--end', '10'], { config })

		assert.equal(code, 1)
		assert.equal(server.requests.length, before + 1)
	})
})

describe('help', () => {
	test('is printed to stderr, leaving stdout clean', async () => {
		const { stdout, stderr, code } = await cli(['--help'])

		assert.equal(code, 0)
		assert.equal(stdout, '')
		assert.match(stderr, /run \[options\] <command\.\.\.>/)
	})

	// Every command carries its own examples, which is the whole reason for the help
	// living beside the parser rather than in a string of its own.
	test('a subcommand documents itself, examples included', async () => {
		const { stdout, stderr, code } = await cli(['update', '--help'])

		assert.equal(code, 0)
		assert.equal(stdout, '')
		assert.match(stderr, /--values <key=value>/)
		assert.match(stderr, /Examples:/)
		assert.match(stderr, /--values status=failed/)
	})

	test('a bare invocation is a usage error', async () => {
		const { stdout, code } = await cli([])

		assert.equal(code, 1)
		assert.equal(stdout, '')
	})

	test('an unknown command exits non-zero', async () => {
		const { code, stderr } = await cli(['frobnicate'])

		assert.equal(code, 1)
		assert.match(stderr, /unknown command/)
	})
})

// Bindings live in the global file, keyed by directory, the way git's includeIf does.
// A file inside the project would be the one that gets committed, and a space uuid is a
// credential.
describe('a space bound to a directory', () => {
	async function bound() {
		const { config, space: fallback } = await freshSpace()
		const project = mkdtempSync(join(tmpdir(), 'pw-project-'))
		const created = await cli(['space', 'new', 'Project space'], { config })
		const project_space = created.stdout.trim()

		await cli(['space', 'use', fallback], { config })
		await cli(['space', 'use', project_space, '--local'], { config, cwd: project })

		return { config, project, project_space, fallback }
	}

	test('reports into the bound space rather than the default', async () => {
		const { config, project, project_space, fallback } = await bound()

		const here = await cli(['list', '--json'], { config, cwd: project })
		const elsewhere = await cli(['list', '--json'], { config })

		assert.equal(JSON.parse(here.stdout).uuid, project_space)
		assert.equal(JSON.parse(elsewhere.stdout).uuid, fallback)
	})

	test('applies to subdirectories too', async () => {
		const { config, project, project_space } = await bound()
		const nested = join(project, 'a', 'b')
		mkdirSync(nested, { recursive: true })

		const { stdout } = await cli(['list', '--json'], { config, cwd: nested })

		assert.equal(JSON.parse(stdout).uuid, project_space)
	})

	test('the deepest binding wins', async () => {
		const { config, project } = await bound()
		const nested = join(project, 'inner')
		mkdirSync(nested, { recursive: true })
		const created = await cli(['space', 'new', 'Inner'], { config })
		const inner = created.stdout.trim()
		await cli(['space', 'use', inner, '--local'], { config, cwd: nested })

		const { stdout } = await cli(['list', '--json'], { config, cwd: nested })

		assert.equal(JSON.parse(stdout).uuid, inner)
	})

	// CI sets the variable and must not be second-guessed by whatever directory the
	// checkout happens to sit in.
	test('PROGRESSWATCH_SPACE still wins', async () => {
		const { config, project, fallback } = await bound()

		const { stdout } = await cli(['list', '--json'], {
			config,
			cwd: project,
			env: { PROGRESSWATCH_SPACE: fallback },
		})

		assert.equal(JSON.parse(stdout).uuid, fallback)
	})

	// Creating and binding in one step, because the two-step form left a window where a
	// fresh space had silently become the global default.
	test('space new --local binds without touching the default', async () => {
		const { config, space: fallback } = await freshSpace()
		const project = mkdtempSync(join(tmpdir(), 'pw-project-'))

		const created = await cli(['space', 'new', 'Local only', '--local'], { config, cwd: project })
		const local = created.stdout.trim()

		const here = await cli(['list', '--json'], { config, cwd: project })
		const elsewhere = await cli(['list', '--json'], { config })

		assert.equal(JSON.parse(here.stdout).uuid, local)
		assert.equal(JSON.parse(elsewhere.stdout).uuid, fallback)
	})

	test('unbind returns the directory to the default', async () => {
		const { config, project, fallback } = await bound()

		await cli(['space', 'unbind'], { config, cwd: project })
		const { stdout } = await cli(['list', '--json'], { config, cwd: project })

		assert.equal(JSON.parse(stdout).uuid, fallback)
	})
})
