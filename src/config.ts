import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_SERVER = 'https://progress.watch'

export type SpaceEntry = {
	uuid: string
	title?: string
	icon?: string
	// Resolved once when the space was added. Never turn this into a live lookup of
	// the default: changing the default would silently repoint existing spaces.
	server: string
}

export type Config = {
	server?: string
	space?: string
	spaces: SpaceEntry[]
	// Directory bindings live here rather than in a file inside the project, the way
	// git's includeIf does: a space uuid is a credential, and a per-project file is the
	// one that gets committed.
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
		// Must not throw: CI runs from environment variables alone, with no config
		// file on disk.
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

// The longest binding that is a parent of the working directory wins, so a binding on a
// subdirectory overrides one on the repository above it.
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
