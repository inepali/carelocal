#!/usr/bin/env node
/**
 * Guards the staff / child split of center_document_requirements.
 *
 * Requirement rules carry an `audience` ('staff' | 'child'). A query that LISTS requirements without
 * filtering on it would show child rules on staff screens, so every `from('center_document_requirements')`
 * in src/ must do one of:
 *   - filter on audience (`.eq('audience', 'staff')`), or
 *   - write or fetch a single row (`.update(`, `.insert(`, `.delete(`, or `.eq('id', ...)`), or
 *   - carry a `// audience-ok: <reason>` comment in the 300 characters before it.
 * Run it with `npm run check:audience`. Exit code 1 lists the offending queries.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const MARK = "from('center_document_requirements')"
const problems = []

/** The rest of one query: what is left on its line, then each following line that continues the method chain (starts with ".") */
function queryChain(text, from) {
  const lines = text.slice(from).split('\n')
  const out = [lines[0]]
  for (let i = 1; i < lines.length && out.length < 30; i++) {
    if (!/^\s*\./.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) { walk(path); continue }
    if (!/\.(ts|tsx)$/.test(name)) continue
    const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
    let at = text.indexOf(MARK)
    while (at !== -1) {
      const before = text.slice(Math.max(0, at - 300), at)
      const chain = queryChain(text, at + MARK.length)
      const single = /^\s*\.(update|insert|delete)\(/.test(chain) || /\.eq\('id'/.test(chain)
      const ok = /audience/.test(chain) || single || /audience-ok/.test(before)
      if (!ok) problems.push(`${relative(ROOT, path)}:${text.slice(0, at).split('\n').length}`)
      at = text.indexOf(MARK, at + MARK.length)
    }
  }
}

walk(join(ROOT, 'src'))

if (problems.length) {
  console.error('Requirement queries that list rules without filtering on audience:')
  for (const p of problems) console.error('  ' + p)
  console.error("\nAdd .eq('audience', 'staff') (or 'child'), or a `// audience-ok: <reason>` comment above the query.")
  process.exit(1)
}
console.log('check:audience ok: every requirement query is audience-safe')
