import { ApiError, createTask, getSpace, getTask, type Task, updateTask } from '../api.js'
import { readConfig, resolveSpace, serverForSpace } from '../config.js'
import { formatTask, info, json, out } from '../output.js'

export function requireSpace(): { server: string; space: string } {
	const config = readConfig()
	const space = resolveSpace(config)
	if (!space) {
		// configure comes first: a self-hoster who runs `space new` without it creates the
		// space on progress.watch and only finds out when the dashboard is empty.
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

// A server only ever comes from a space entry, never from a global default. Commands
// addressed by task uuid therefore need a space to say which server to talk to — use
// --space to point them at one other than the default.
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

// A step with nothing to count still has something to say: that it began. Without this
// it sits at "waiting for data", which a watcher cannot tell apart from a reporter that
// died before its first write.
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

// The same order Tasks::PrepareForDashboard renders: whatever is still running on top,
// newest first in both groups. The API keeps creation order for every client, so a space
// with a year of history opened on its oldest task.
//
// Children are left alone — they are the steps of one job, and reading them backwards is
// reading the job backwards. --json is untouched too: it is the server's payload verbatim.
function order(tasks: Task[]): Task[] {
	const [active, finished] = [tasks.filter((t) => !t.finished_at), tasks.filter((t) => t.finished_at)]

	return [...active.reverse(), ...finished.reverse()]
}

export async function taskList(asJson: boolean): Promise<void> {
	const { server, space } = requireSpace()
	const result = await getSpace(server, space)

	if (asJson) {
		json(result)
		return
	}

	if (result.tasks.length === 0) {
		info(`No tasks in "${result.title ?? space}".`)
		return
	}

	info(`${result.title ?? space}  (${server})`)
	info()
	for (const task of order(result.tasks)) {
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
