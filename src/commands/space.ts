import { createSpace } from '../api.js'
import { spaceLink } from './connect.js'
import { type Config, readConfig, resolveServer, serverForSpace, spaceForDirectory, writeConfig } from '../config.js'
import { info, json, out } from '../output.js'

export async function spaceNew(
	title: string | undefined,
	icon: string | undefined,
	asJson: boolean,
	local: boolean,
): Promise<void> {
	const config = readConfig()
	const server = resolveServer(config)
	const space = await createSpace(server, title, icon)

	const entry = { uuid: space.uuid, title: space.title ?? undefined, icon: space.icon ?? undefined, server }
	config.spaces = [...config.spaces.filter((s) => s.uuid !== space.uuid), entry]
	config.server ??= server

	const directory = process.cwd()
	if (local) {
		config.paths = { ...config.paths, [directory]: space.uuid }
	} else {
		config.space = space.uuid
	}
	writeConfig(config)

	if (asJson) {
		json(entry)
	} else {
		out(space.uuid)
	}

	const where = local ? `the space for ${directory}` : 'the default'
	info(`Created space "${space.title ?? 'untitled'}" on ${server} and made it ${where}.`)
	info(`Watch it:  ${spaceLink(server, space.uuid)}`)
	info('On a phone: progresswatch connect  (same link, as a QR to scan)')
}

export function spaceList(asJson: boolean): void {
	const config = readConfig()
	const bound = spaceForDirectory(config)
	const current = process.env.PROGRESSWATCH_SPACE || bound || config.space

	if (asJson) {
		json(config.spaces.map((entry) => ({ ...entry, default: entry.uuid === current })))
		return
	}

	if (config.spaces.length === 0) {
		info('No spaces yet. Create one with: progresswatch space new "My space"')
		return
	}

	for (const entry of config.spaces) {
		const marker = entry.uuid === current ? '*' : ' '
		const name = [entry.icon, entry.title ?? '(untitled)'].filter(Boolean).join(' ')
		info(`${marker} ${entry.uuid}  ${name}  ${entry.server}`)
	}

	if (bound) info(`\n* bound to ${process.cwd()}`)
}

export function spaceUse(uuid: string, server: string | undefined, local: boolean): void {
	const config: Config = readConfig()
	const existing = config.spaces.find((entry) => entry.uuid === uuid)

	if (!existing) {
		config.spaces.push({ uuid, server: server ?? resolveServer(config) })
	} else if (server) {
		existing.server = server
	}

	if (local) {
		const directory = process.cwd()
		config.paths = { ...config.paths, [directory]: uuid }
		writeConfig(config)

		info(`${directory} now reports into ${uuid} on ${serverForSpace(config, uuid)}`)
		return
	}

	config.space = uuid
	writeConfig(config)

	info(`Default space is now ${uuid} on ${serverForSpace(config, uuid)}`)
}

export function spaceUnbind(): void {
	const config = readConfig()
	const directory = process.cwd()

	if (!config.paths?.[directory]) {
		info(`${directory} is not bound to a space.`)
		return
	}

	delete config.paths[directory]
	writeConfig(config)

	info(`${directory} is no longer bound. Falling back to the default space.`)
}
