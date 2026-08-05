import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

// Must keep mirroring the real server's semantics — full overwrite, one-level
// nesting — or these tests stop meaning anything.
export async function startMockServer() {
	const spaces = new Map()
	const tasks = new Map()
	const state = new Map()
	const requests = []

	const snapshot = (task) => {
		const children = [...tasks.values()].filter((t) => t.parent_uuid === task.uuid)
		const own = state.get(task.uuid) ?? null

		let progress = own
		if (children.length > 0) {
			const ratios = children.map((child) => {
				if (child.finished_at) return 1
				const s = state.get(child.uuid)
				if (!s || s.end === null || s.end === undefined || s.end <= 0) return 0
				return Math.min(1, s.current / s.end)
			})
			progress = {
				current: children.filter((c) => c.finished_at).length,
				end: children.length,
				ratio: ratios.reduce((a, b) => a + b, 0) / ratios.length,
				values: own?.values ?? {},
				updated_at: own?.updated_at ?? null,
				aggregated: true,
			}
		}

		return { ...task, progress, children: children.map(snapshot) }
	}

	// Returns a status to fail with, or anything falsy to let the request through.
	let failWhen = null

	const server = createServer((req, res) => {
		let body = ''
		req.on('data', (chunk) => {
			body += chunk
		})
		req.on('end', () => {
			const payload = body ? JSON.parse(body) : {}
			requests.push({ method: req.method, url: req.url, payload })

			const send = (status, data) => {
				res.writeHead(status, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(data))
			}

			const fail = failWhen?.({ method: req.method, url: req.url ?? '', payload })
			if (fail) return send(fail, { error: 'Deliberate failure' })

			const url = req.url ?? ''

			if (req.method === 'POST' && url === '/spaces') {
				const space = { uuid: randomUUID(), title: payload.title ?? null, icon: payload.icon ?? null }
				spaces.set(space.uuid, space)
				return send(201, space)
			}

			let match = url.match(/^\/spaces\/([^/]+)\/tasks$/)
			if (req.method === 'POST' && match) {
				const spaceUuid = match[1]
				if (!spaces.has(spaceUuid)) return send(404, { error: 'Space not found' })

				const parent = payload.parent_uuid ? tasks.get(payload.parent_uuid) : null
				if (payload.parent_uuid && !parent) {
					return send(422, { error: 'Parent uuid does not reference a known task' })
				}
				if (parent?.parent_uuid) {
					return send(422, {
						error: 'Parent uuid references a task that is already a child; nesting is one level only',
					})
				}

				const task = {
					uuid: randomUUID(),
					space_uuid: spaceUuid,
					parent_uuid: payload.parent_uuid ?? null,
					title: payload.title ?? null,
					source: payload.source ?? null,
					created_at: new Date().toISOString(),
					finished_at: null,
					duration: null,
				}
				tasks.set(task.uuid, task)
				return send(201, { uuid: task.uuid })
			}

			match = url.match(/^\/spaces\/([^/]+)$/)
			if (req.method === 'GET' && match) {
				const space = spaces.get(match[1])
				if (!space) return send(404, { error: 'Space not found' })

				const top = [...tasks.values()].filter(
					(t) => t.space_uuid === space.uuid && t.parent_uuid === null,
				)
				return send(200, { ...space, tasks: top.map(snapshot) })
			}

			match = url.match(/^\/tasks\/([^/]+)$/)
			if (match) {
				const task = tasks.get(match[1])
				if (!task) return send(404, { error: 'Task not found' })

				if (req.method === 'PUT') {
					// Full overwrite: anything omitted is gone, not preserved.
					const current = payload.current ?? null
					const end = payload.end ?? null
					state.set(task.uuid, {
						current,
						end,
						ratio: end !== null && end > 0 && current !== null ? Math.min(1, current / end) : null,
						values: payload.values ?? {},
						updated_at: new Date().toISOString(),
						aggregated: false,
					})

					const complete = payload.done === true || (current !== null && end !== null && end > 0 && current >= end)
					if (complete && !task.finished_at) {
						task.finished_at = new Date().toISOString()
						task.duration = 0
					}
				}

				return send(200, snapshot(task))
			}

			if (req.method === 'GET' && url === '/up') return send(200, { status: 'ok' })

			return send(404, { error: 'Not found' })
		})
	})

	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address()

	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		tasks,
		state,
		failWhen: (predicate) => {
			failWhen = predicate
		},
		close: () => new Promise((resolve) => server.close(resolve)),
	}
}
