import qrcode from 'qrcode-terminal'
import { readConfig, resolveSpace, serverForSpace } from '../config.js'
import { info, out } from '../output.js'

export function spaceLink(server: string, spaceUuid: string): string {
	return `${server.replace(/\/$/, '')}/s/${encodeURIComponent(spaceUuid)}`
}

export function connect(asJson: boolean): void {
	const config = readConfig()
	const space = resolveSpace(config)
	if (!space) throw new Error('no default space. Create one with: progresswatch space new')

	const server = serverForSpace(config, space)
	const link = spaceLink(server, space)

	if (asJson) {
		out(JSON.stringify({ server, space, link }, null, 2))
		return
	}

	qrcode.generate(link, { small: true }, (qr: string) => info(qr))
	info(`Space:  ${space}`)
	info(`Server: ${server}`)
	info('Scan it, or open the link on your phone. Add the page to the home screen to get notifications.')
	out(link)
}
