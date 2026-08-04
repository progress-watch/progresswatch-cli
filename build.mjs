import { chmodSync } from 'node:fs'
import { build } from 'esbuild'

// Dependencies stay external so they install normally rather than being vendored into
// the bundle.
await build({
	entryPoints: ['src/cli.ts'],
	outfile: 'dist/cli.js',
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	external: ['qrcode-terminal', 'commander'],
	banner: { js: '#!/usr/bin/env node' },
})

chmodSync('dist/cli.js', 0o755)
