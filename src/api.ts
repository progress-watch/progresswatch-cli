// The only place this CLI talks HTTP. Native fetch, no client library.

export type Progress = {
	current: number | null
	end: number | null
	ratio: number | null
	values: Record<string, string | number | boolean | null>
	updated_at: string | null
	aggregated: boolean
}

export type Task = {
	uuid: string
	space_uuid: string
	parent_uuid: string | null
	title: string | null
	source: string | null
	created_at: string
	finished_at: string | null
	duration: number | null
	// null means the task exists but has reported nothing, which is not zero.
	progress: Progress | null
	children: Task[]
}

export type Space = {
	uuid: string
	title: string | null
	icon: string | null
	tasks: Task[]
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message)
		this.name = 'ApiError'
	}
}

async function request<T>(server: string, method: string, path: string, body?: unknown): Promise<T> {
	const url = `${server.replace(/\/+$/, '')}${path}`

	let response: Response
	try {
		response = await fetch(url, {
			method,
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		})
	} catch (cause) {
		throw new ApiError(`cannot reach ${server}: ${(cause as Error).message}`)
	}

	const text = await response.text()

	if (!response.ok) {
		let message = `HTTP ${response.status}`
		try {
			const parsed = JSON.parse(text) as { error?: string }
			if (parsed.error) message = parsed.error
		} catch {
			if (text) message = `${message}: ${text.slice(0, 200)}`
		}
		throw new ApiError(message, response.status)
	}

	return (text ? JSON.parse(text) : {}) as T
}

export type SpaceSummary = { uuid: string; title: string | null; icon: string | null }

export function createSpace(server: string, title?: string, icon?: string) {
	return request<SpaceSummary>(server, 'POST', '/spaces', { title, icon })
}


export function getSpace(server: string, spaceUuid: string) {
	return request<Space>(server, 'GET', `/spaces/${spaceUuid}`)
}

export function createTask(
	server: string,
	spaceUuid: string,
	payload: { title?: string; source?: string; parent_uuid?: string },
) {
	return request<{ uuid: string }>(server, 'POST', `/spaces/${spaceUuid}/tasks`, payload)
}

// Full overwrite: anything left out is cleared server-side, not preserved.
export function updateTask(
	server: string,
	taskUuid: string,
	payload: {
		current?: number
		end?: number
		values?: Record<string, string | number | boolean>
		done?: boolean
	},
) {
	return request<Task>(server, 'PUT', `/tasks/${taskUuid}`, payload)
}

export function getTask(server: string, taskUuid: string) {
	return request<Task>(server, 'GET', `/tasks/${taskUuid}`)
}
