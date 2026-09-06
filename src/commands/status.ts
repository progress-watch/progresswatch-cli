import { ApiError, getHealth } from '../api.js'
import { readConfig, resolveSpace, serverForSpace } from '../config.js'
import { info, json } from '../output.js'

type Report = {
	space: string | null
	title: string | null
	server: string | null
	reachable: boolean
	database: boolean | null
	redis: boolean | null
	error: string | null
}

async function check(server: string): Promise<Partial<Report>> {
	try {
		const health = await getHealth(server)
		return { reachable: true, database: health.database, redis: health.redis, error: null }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return { reachable: false, database: null, redis: null, error: message }
	}
}

export async function status(options: { asJson: boolean }): Promise<void> {
	const config = readConfig()
	const space = resolveSpace(config)
	const entry = config.spaces.find((candidate) => candidate.uuid === space)

	const report: Report = {
		space: space ?? null,
		title: entry?.title ?? null,
		server: space ? serverForSpace(config, space) : null,
		reachable: false,
		database: null,
		redis: null,
		error: space ? null : 'no space selected',
		...(space ? await check(serverForSpace(config, space)) : {}),
	}

	if (options.asJson) json(report)
	else print(report)

	if (!report.space || !report.reachable || report.database === false || report.redis === false) {
		throw new ApiError(report.error ?? 'the server is up but something it needs is not')
	}
}

function print(report: Report): void {
	const from = (variable: string) => (process.env[variable] ? `  (from ${variable})` : '')

	if (!report.space) {
		info('Space:     none selected')
		info('Run `progresswatch space new "My work"`, or `space use <uuid>` for one you already have.')
		return
	}

	info(`Space:     ${report.space}${report.title ? `  "${report.title}"` : ''}${from('PROGRESSWATCH_SPACE')}`)
	info(`Server:    ${report.server}${from('PROGRESSWATCH_SERVER')}`)
	info(`Health:    ${health(report)}`)
}

function health(report: Report): string {
	if (!report.reachable) return `unreachable — ${report.error}`

	const parts = [`database ${report.database ? 'ok' : 'down'}`, `redis ${report.redis ? 'ok' : 'down'}`]

	return `${report.database && report.redis ? 'ok' : 'degraded'}  (${parts.join(', ')})`
}
