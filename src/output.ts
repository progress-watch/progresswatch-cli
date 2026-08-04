import type { Task } from './api.js'

// out() is stdout and carries machine-consumable output only; info() is stderr and
// carries everything a human reads. Using console.log anywhere breaks that split.
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

function statusSuffix(task: Task): string {
	if (task.finished_at === null) return ''
	return task.duration === null ? '  (finished)' : `  (finished in ${task.duration}s)`
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
