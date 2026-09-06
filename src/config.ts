import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_SERVER = 'https://progress.watch'

export type SpaceEntry = {
	uuid: string
	title?: string
	icon?: string
	server: string
}

export type Config = {
	server?: string
	space?: string
	spaces: SpaceEntry[]
	paths?: Record<string, string>
}

export function configPath(): string {
	return process.env.PROGRESSWATCH_CONFIG ?? join(homedir(), '.progresswatchrc')
}

export function readConfig(): Config {
	try {
		const parsed = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<Config>
		return { ...parsed, spaces: parsed.spaces ?? [] }
	} catch {
		return { spaces: [] }
	}
}

export function writeConfig(config: Config): void {
	const path = configPath()
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
	// The mode above applies only to a newly created file, and a space uuid is a
	// credential.
	chmodSync(path, 0o600)
}

export function resolveServer(config: Config = readConfig()): string {
	return process.env.PROGRESSWATCH_SERVER || config.server || DEFAULT_SERVER
}

export function resolveSpace(config: Config = readConfig()): string | undefined {
	return process.env.PROGRESSWATCH_SPACE || spaceForDirectory(config) || config.space
}

export function spaceForDirectory(config: Config, from: string = process.cwd()): string | undefined {
	const bindings = Object.entries(config.paths ?? {})
		.filter(([path]) => from === path || from.startsWith(`${path}/`))
		.sort(([a], [b]) => b.length - a.length)

	return bindings[0]?.[1]
}

export function serverForSpace(config: Config, spaceUuid: string): string {
	if (process.env.PROGRESSWATCH_SERVER) return process.env.PROGRESSWATCH_SERVER

	return config.spaces.find((entry) => entry.uuid === spaceUuid)?.server ?? resolveServer(config)
}
