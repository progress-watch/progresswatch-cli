import { ApiError, createTask, getSpace, getTask, updateTask, type Window } from '../api.js'
import { readConfig, resolveSpace, serverForSpace } from '../config.js'
import { formatTask, info, json, out } from '../output.js'

export const DEFAULT_LIST = 20

export function requireSpace(): { server: string; space: string } {
	const config = readConfig()
	const space = resolveSpace(config)
	if (!space) {
		throw new Error(
			'no space selected.\n' +
				'  Self-hosting?  progresswatch configure --server https://your.host\n' +
				'  Then:          progresswatch space new "My space"\n' +
				'  Have one?      progresswatch space use <uuid>\n' +
				'  One command:   --space <uuid>, or PROGRESSWATCH_SPACE',
		)
	}

	return { server: serverForSpace(config, space), space }
}

async function onTask<T>(uuid: string, call: (server: string) => Promise<T>): Promise<T> {
	const { server, space } = requireSpace()

	try {
		return await call(server)
	} catch (error) {
		if (!(error instanceof ApiError) || (error.status !== undefined && error.status !== 404)) throw error

		throw new ApiError(
			`${error.message}\n` +
				`  ${server} is where space ${space} lives. A task uuid does not carry a server of its own.\n` +
				`  If ${uuid} belongs elsewhere:  --space <uuid>`,
			error.status,
		)
	}
}

export async function taskNew(
	title: string,
	options: { parent?: string; source?: string },
	asJson: boolean,
): Promise<void> {
	const { server, space } = requireSpace()
	const task = await createTask(server, space, {
		title,
		source: options.source ?? 'progresswatch-cli',
		parent_uuid: options.parent,
	})

	if (asJson) {
		json(task)
	} else {
		out(task.uuid)
	}
	info(`Created task "${title}"`)
}

export async function taskUpdate(
	uuid: string,
	options: {
		current?: number
		end?: number
		values?: Record<string, string | number | boolean>
		done?: boolean
	},
	asJson: boolean,
): Promise<void> {
	const task = await onTask(uuid, (server) => updateTask(server, uuid, options))

	if (asJson) {
		json(task)
	} else {
		info(formatTask(task))
	}
}

export async function taskStart(uuid: string, asJson: boolean): Promise<void> {
	const task = await onTask(uuid, (server) => updateTask(server, uuid, { current: 0, end: 1 }))

	if (asJson) {
		json(task)
	} else {
		info(`Started "${task.title ?? uuid}".`)
	}
}

export async function taskDone(uuid: string, asJson: boolean): Promise<void> {
	const task = await onTask(uuid, (server) => updateTask(server, uuid, { done: true }))

	if (asJson) {
		json(task)
	} else {
		info(`Marked "${task.title ?? uuid}" done.`)
	}
}

export async function taskList(asJson: boolean, window: Window): Promise<void> {
	const { server, space } = requireSpace()

	if (asJson) {
		json(await getSpace(server, space, window))
		return
	}

	const limit = window.limit ?? DEFAULT_LIST
	const [active, finished] = await Promise.all([
		getSpace(server, space, { ...window, limit, state: 'active' }),
		getSpace(server, space, { ...window, limit, state: 'finished' }),
	])

	const tasks = [
		...active.tasks.filter((task) => !task.finished_at).reverse(),
		...finished.tasks.filter((task) => task.finished_at).reverse(),
	].slice(0, limit)

	if (tasks.length === 0) {
		info(`No tasks in "${active.title ?? space}".`)
		return
	}

	info(`${active.title ?? space}  (${server})`)
	info()

	for (const task of tasks) {
		info(formatTask(task, '  '))
		info()
	}
}

export async function taskShow(uuid: string, asJson: boolean): Promise<void> {
	const task = await onTask(uuid, (server) => getTask(server, uuid))

	if (asJson) {
		json(task)
	} else {
		info(formatTask(task))
	}
}
