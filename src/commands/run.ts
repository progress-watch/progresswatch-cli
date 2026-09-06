import { spawn } from 'node:child_process'
import { COMPLETION_RETRY_DELAYS, createTask, updateTask } from '../api.js'
import { info } from '../output.js'
import { requireSpace } from './task.js'

const HEARTBEAT_MS = 30_000

type RunOptions = { title?: string; parent?: string }

export async function run(command: string[], options: RunOptions): Promise<never> {
	const { server, space } = requireSpace()
	const label = options.title ?? command.join(' ')

	const task = await createTask(server, space, {
		title: label,
		source: 'progresswatch run',
		parent_uuid: options.parent,
	})

	const startedAt = Date.now()
	const running = { current: 0, end: 1, values: { status: 'running', command: command.join(' ') } }

	const report = async (payload: Parameters<typeof updateTask>[2], delays?: number[]) => {
		try {
			await updateTask(server, task.uuid, payload, delays)
			return true
		} catch (error) {
			info(`progresswatch: could not report progress: ${(error as Error).message}`)
			return false
		}
	}

	await report(running)
	info(`progresswatch: tracking "${label}" as ${task.uuid}`)

	const heartbeat = setInterval(() => {
		void report({
			...running,
			values: { ...running.values, elapsed: Math.round((Date.now() - startedAt) / 1000) },
		})
	}, HEARTBEAT_MS)
	heartbeat.unref()

	const [head, ...rest] = command
	const child =
		command.length === 1
			? spawn(head as string, { stdio: 'inherit', shell: true })
			: spawn(head as string, rest, { stdio: 'inherit' })

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => child.kill(signal))
	}

	const { code, signal } = await new Promise<{ code: number | null; signal: string | null }>(
		(resolve) => {
			child.on('error', (error) => {
				info(`progresswatch: ${error.message}`)
				resolve({ code: 127, signal: null })
			})
			child.on('exit', (code, signal) => resolve({ code, signal }))
		},
	)

	clearInterval(heartbeat)

	const exitCode = code ?? 1
	const failed = exitCode !== 0 || signal !== null
	const elapsed = Math.round((Date.now() - startedAt) / 1000)

	const reported = await report(
		{
			current: 1,
			end: 1,
			done: true,
			values: {
				status: failed ? 'failed' : 'succeeded',
				exit_code: exitCode,
				elapsed,
				command: command.join(' '),
				...(signal ? { signal } : {}),
				log: failed
					? `Exited with code ${exitCode}${signal ? ` (${signal})` : ''} after ${elapsed}s`
					: `Completed in ${elapsed}s`,
			},
		},
		COMPLETION_RETRY_DELAYS,
	)

	info(
		failed
			? `progresswatch: "${label}" failed with code ${exitCode} after ${elapsed}s`
			: `progresswatch: "${label}" finished in ${elapsed}s`,
	)

	if (!reported) {
		info(`progresswatch: the server was not told. "${label}" stays open until its data expires.`)
	}

	process.exit(exitCode)
}
