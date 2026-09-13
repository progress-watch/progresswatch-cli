import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const SERVER = process.env.PROGRESSWATCH_E2E_SERVER?.replace(/\/+$/, '')
if (!SERVER) throw new Error('PROGRESSWATCH_E2E_SERVER must point at a running Progress Watch server')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const home = mkdtempSync(join(tmpdir(), 'pw-e2e-'))
after(() => rmSync(home, { recursive: true, force: true }))

function cli(args, options = {}) {
	const env = { ...process.env }
	delete env.PROGRESSWATCH_SERVER
	delete env.PROGRESSWATCH_SPACE
	Object.assign(env, { PROGRESSWATCH_CONFIG: options.config ?? join(home, 'rc.json') }, options.env)

	return new Promise((resolve) => {
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

async function json(args, options) {
	const { code, stdout, stderr } = await cli([...args, '--json'], options)
	assert.equal(code, 0, stderr)
	return JSON.parse(stdout)
}

async function freshSpace(title = 'e2e') {
	const config = join(mkdtempSync(join(home, 'config-')), 'rc.json')

	const configured = await cli(['configure', '--server', SERVER], { config })
	assert.equal(configured.code, 0, configured.stderr)

	const created = await cli(['space', 'new', title], { config })
	assert.equal(created.code, 0, created.stderr)

	return { config, space: created.stdout.trim() }
}

async function newTask(title, options, ...flags) {
	const { code, stdout, stderr } = await cli(['new', title, ...flags], options)
	assert.equal(code, 0, stderr)
	return stdout.trim()
}

async function taskTitled(title, options) {
	return (await json(['list'], options)).tasks.find((task) => task.title === title)
}

describe('configure and status', () => {
	test('configure checks the server answers and records it', async () => {
		const config = join(mkdtempSync(join(home, 'config-')), 'rc.json')

		const { code, stderr } = await cli(['configure', '--server', SERVER], { config })

		assert.equal(code, 0, stderr)
		assert.equal((await json(['configure', '--list'], { config })).server, SERVER)
	})

	test('status names the space and the server, and exits zero when both are healthy', async () => {
		const { config, space } = await freshSpace()

		const { code, stdout, stderr } = await cli(['status'], { config })
		assert.equal(code, 0, stderr)
		assert.equal(stdout, '')
		assert.match(stderr, /Health: +ok/)

		const report = await json(['status'], { config })
		assert.equal(report.space, space)
		assert.equal(report.server, SERVER)
		assert.equal(report.reachable, true)
		assert.equal(report.database, true)
		assert.equal(report.redis, true)
	})
})

describe('spaces', () => {
	test('space new prints a bare uuid and makes it the default', async () => {
		const { config, space } = await freshSpace('Nightly')

		assert.match(space, UUID)

		const entry = (await json(['space', 'list'], { config })).find((candidate) => candidate.uuid === space)
		assert.equal(entry.default, true)
		assert.equal(entry.server, SERVER)
		assert.equal(entry.title, 'Nightly')
	})

	test('space use joins a space someone else created, on the server it names', async () => {
		const owner = await freshSpace()
		const guest = join(mkdtempSync(join(home, 'config-')), 'rc.json')

		const used = await cli(['space', 'use', owner.space, '--server', SERVER], { config: guest })
		assert.equal(used.code, 0, used.stderr)
		await newTask('Reported by a guest', { config: guest })

		assert.ok(await taskTitled('Reported by a guest', { config: owner.config }))
	})

	test('a directory bound with --local reports there, and unbind hands it back to the default', async () => {
		const { config, space } = await freshSpace()
		const directory = mkdtempSync(join(home, 'project-'))
		const options = { config, cwd: directory }

		const bound = (await cli(['space', 'new', 'Project', '--local'], options)).stdout.trim()
		const inside = await newTask('Inside the project', options)
		assert.equal((await json(['show', inside], options)).space_uuid, bound)

		const unbound = await cli(['space', 'unbind'], options)
		assert.equal(unbound.code, 0, unbound.stderr)

		const outside = await newTask('After unbinding', options)
		assert.equal((await json(['show', outside], options)).space_uuid, space)
	})

	test('connect prints a link the server actually serves', async () => {
		const { config, space } = await freshSpace()

		const { link } = await json(['connect'], { config })

		assert.equal(link, `${SERVER}/s/${space}`)
		assert.equal((await fetch(link)).status, 200)
	})
})

describe('tasks', () => {
	test('new prints a bare uuid, and show finds it waiting for data', async () => {
		const { config } = await freshSpace()

		const task = await newTask('Crawl docs', { config }, '--source', 'crawler.py')
		assert.match(task, UUID)

		const shown = await json(['show', task], { config })
		assert.equal(shown.title, 'Crawl docs')
		assert.equal(shown.source, 'crawler.py')
		assert.equal(shown.progress, null)
		assert.equal(shown.finished_at, null)
	})

	test('update sends counts and typed values, and the server keeps the types', async () => {
		const { config } = await freshSpace()
		const task = await newTask('Crawl docs', { config })

		const updated = await cli(
			['update', task, '--current', '5', '--end', '10', '--values', 'pages=5', '--values', 'ok=true', '--values', 'log=hello'],
			{ config },
		)
		assert.equal(updated.code, 0, updated.stderr)

		const { progress } = await json(['show', task], { config })
		assert.equal(progress.current, 5)
		assert.equal(progress.end, 10)
		assert.equal(progress.ratio, 0.5)
		assert.deepEqual(progress.values, { pages: 5, ok: true, log: 'hello' })
	})

	test('a later update without values clears them, because a write replaces the whole state', async () => {
		const { config } = await freshSpace()
		const task = await newTask('Crawl docs', { config })

		await cli(['update', task, '--current', '5', '--end', '10', '--values', 'pages=5'], { config })
		await cli(['update', task, '--current', '6', '--end', '10'], { config })

		const { progress } = await json(['show', task], { config })
		assert.equal(progress.current, 6)
		assert.deepEqual(progress.values, {})
	})

	test('start moves a task off waiting without inventing a count', async () => {
		const { config } = await freshSpace()
		const task = await newTask('Migrate', { config })

		const started = await cli(['start', task], { config })
		assert.equal(started.code, 0, started.stderr)

		const shown = await json(['show', task], { config })
		assert.equal(shown.progress.current, 0)
		assert.equal(shown.progress.end, 1)
		assert.equal(shown.finished_at, null)
	})

	test('done finishes the task and keeps the last counts it had', async () => {
		const { config } = await freshSpace()
		const task = await newTask('Backup', { config })
		await cli(['update', task, '--current', '6', '--end', '10'], { config })

		const done = await cli(['done', task], { config })
		assert.equal(done.code, 0, done.stderr)

		const shown = await json(['show', task], { config })
		assert.ok(shown.finished_at)
		assert.equal(shown.progress.ratio, 1)
		assert.equal(shown.progress.current, 6)
	})

	test('values sent in the same write as done stay on the finished task', async () => {
		const { config } = await freshSpace()
		const task = await newTask('Nightly import', { config })

		const { code, stderr } = await cli(['update', task, '--values', 'status=failed', '--values', 'exit_code=3', '--done'], { config })
		assert.equal(code, 0, stderr)

		const shown = await json(['show', task], { config })
		assert.ok(shown.finished_at)
		assert.equal(shown.progress.values.status, 'failed')
		assert.equal(shown.progress.values.exit_code, 3)
	})

	test('steps nest under their parent, and the parent bar is the average of theirs', async () => {
		const { config } = await freshSpace()
		const parent = await newTask('Deploy', { config })
		const build = await newTask('Build', { config }, '--parent', parent)
		const tests = await newTask('Test', { config }, '--parent', parent)

		await cli(['update', build, '--current', '5', '--end', '10'], { config })
		await cli(['done', tests], { config })

		const shown = await json(['show', parent], { config })
		assert.deepEqual(
			shown.children.map((child) => child.title),
			['Build', 'Test'],
		)
		assert.equal(shown.progress.aggregated, true)
		assert.equal(shown.progress.current, 1)
		assert.equal(shown.progress.end, 2)
		assert.equal(shown.progress.ratio, 0.75)
	})

	test('a second level of nesting is refused by the server, and nothing reaches stdout', async () => {
		const { config } = await freshSpace()
		const parent = await newTask('Deploy', { config })
		const step = await newTask('Build', { config }, '--parent', parent)

		const { code, stdout, stderr } = await cli(['new', 'Too deep', '--parent', step], { config })

		assert.equal(code, 1)
		assert.equal(stdout, '')
		assert.match(stderr, /one level only/)
	})

	test('a task the server has never seen exits non-zero and says where it looked', async () => {
		const { config } = await freshSpace()

		const { code, stdout, stderr } = await cli(['show', '00000000-0000-4000-8000-000000000000'], { config })

		assert.equal(code, 1)
		assert.equal(stdout, '')
		assert.ok(stderr.includes(`${SERVER} is where space`), stderr)
	})
})

describe('list', () => {
	test('puts what is still running above what has finished, newest first, on stderr', async () => {
		const { config } = await freshSpace()
		const first = await newTask('First', { config })
		await newTask('Second', { config })
		const third = await newTask('Third', { config })
		await cli(['done', first], { config })
		await cli(['done', third], { config })

		const { code, stdout, stderr } = await cli(['list'], { config })

		assert.equal(code, 0, stderr)
		assert.equal(stdout, '')
		const at = (title) => stderr.indexOf(title)
		assert.ok(at('Second') < at('Third') && at('Third') < at('First'), stderr)
	})

	test('renders the newest twenty by default, while --json hands a pipe the whole space', async () => {
		const { config, space } = await freshSpace()
		await Promise.all(
			Array.from({ length: 21 }, (_, n) =>
				fetch(`${SERVER}/spaces/${space}/tasks`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: `Page ${n}` }),
				}).then((response) => assert.equal(response.status, 201)),
			),
		)

		const { stderr } = await cli(['list'], { config })
		assert.equal(stderr.match(/Page \d+/g).length, 20)

		assert.equal((await json(['list'], { config })).tasks.length, 21)
	})

	test('pages back from a created_at, exclusive of the task it came from', async () => {
		const { config } = await freshSpace()
		await newTask('Oldest', { config })
		await newTask('Middle', { config })
		await newTask('Newest', { config })

		const { tasks } = await json(['list'], { config })
		const middle = tasks.find((task) => task.title === 'Middle')

		const before = await json(['list', '--before', middle.created_at], { config })
		assert.deepEqual(
			before.tasks.map((task) => task.title),
			['Oldest'],
		)
	})
})
