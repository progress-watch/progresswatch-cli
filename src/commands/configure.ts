import { createInterface } from 'node:readline/promises'
import { ApiError, getHealth } from '../api.js'
import { DEFAULT_SERVER, readConfig, resolveServer, spaceForDirectory, writeConfig } from '../config.js'
import { info, json } from '../output.js'

async function reachable(server: string): Promise<void> {
	const health = await getHealth(server)
	const down = ['database', 'redis'].filter((part) => health[part as 'database' | 'redis'] === false)

	if (down.length > 0) throw new ApiError(`${server} is up but its ${down.join(' and ')} is not`)
}

export async function configure(options: { server?: string; list: boolean; asJson: boolean }): Promise<void> {
	const config = readConfig()

	if (options.list) {
		const current = {
			server: resolveServer(config),
			default_space: config.space ?? null,
			directory_space: spaceForDirectory(config) ?? null,
			spaces: config.spaces.length,
			config: process.env.PROGRESSWATCH_CONFIG ?? '~/.progresswatchrc',
		}

		if (options.asJson) return json(current)

		// Naming the override matters more than the value: "why is it talking to the wrong
		// host" is almost always an environment variable nobody remembers exporting.
		const from = (variable: string) => (process.env[variable] ? `  (from ${variable})` : '')

		info(`Server:    ${current.server}${from('PROGRESSWATCH_SERVER')}`)
		info(`Default:   ${current.default_space ?? 'none'}${from('PROGRESSWATCH_SPACE')}`)
		if (current.directory_space) info(`Here:      ${current.directory_space}`)
		info(`Spaces:    ${current.spaces}`)
		info(`Config:    ${current.config}`)
		return
	}

	let server = options.server
	if (!server) {
		const rl = createInterface({ input: process.stdin, output: process.stderr })
		server = (await rl.question(`Server [${DEFAULT_SERVER}]: `)).trim() || DEFAULT_SERVER
		rl.close()
	}

	await reachable(server)

	config.server = server.replace(/\/$/, '')
	writeConfig(config)

	info(`Saved. New spaces will be created on ${config.server}.`)
	info('Existing spaces keep the server they were created against — that is per space, not global.')
}
