import type { Task } from './api.js'

export function out(text: string): void {
	process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

export function info(text = ''): void {
	process.stderr.write(text.endsWith('\n') ? text : `${text}\n`)
}

export function json(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const BAR_WIDTH = 24

function bar(ratio: number): string {
	const filled = Math.round(ratio * BAR_WIDTH)
	return `[${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}]`
}

function formatValues(values: Record<string, string | number | boolean | null>): string {
	const entries = Object.entries(values).filter(([key]) => key !== 'log')
	return entries.map(([key, value]) => `${key}=${value}`).join(' ')
}

function formatProgress(task: Task): string {
	if (task.progress === null) return 'waiting for data...'

	const { current, end, ratio, values, aggregated } = task.progress
	const parts: string[] = []

	parts.push(ratio === null ? `[${'?'.repeat(BAR_WIDTH)}]` : bar(ratio))
	parts.push(ratio === null ? '  ? %' : `${(ratio * 100).toFixed(1)}%`.padStart(6))

	if (current !== null && end !== null) {
		parts.push(aggregated ? `${current}/${end} done` : `${current}/${end}`)
	} else if (current !== null) {
		parts.push(`${current}`)
	}

	const rendered = formatValues(values)
	if (rendered) parts.push(rendered)

	return parts.join('  ')
}

function ago(iso: string): string {
	const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)

	if (seconds < 60) return 'just now'
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`

	return `${Math.floor(seconds / 86400)}d ago`
}

function statusSuffix(task: Task): string {
	if (task.finished_at === null) return ''

	const took = task.duration === null ? 'finished' : `finished in ${task.duration}s`

	return `  (${took}, ${ago(task.finished_at)})`
}

export function formatTask(task: Task, indent = ''): string {
	const lines: string[] = []
	const title = task.title || '(untitled)'

	lines.push(`${indent}${title}${statusSuffix(task)}`)
	lines.push(`${indent}  ${formatProgress(task)}`)

	const log = task.progress?.values.log
	if (log !== undefined && log !== null) lines.push(`${indent}  ${log}`)

	lines.push(`${indent}  ${task.uuid}`)

	for (const child of task.children) {
		lines.push(formatTask(child, `${indent}    `))
	}

	return lines.join('\n')
}
