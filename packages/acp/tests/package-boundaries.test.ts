import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

const root = resolve(import.meta.dirname, '..')

describe('aCP package boundaries', () => {
  it('exposes UI separately from the type-only and Node entries', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(manifest.exports['./ui']).toBe('./src/ui/index.ts')
    expect(manifest.exports['./ui/uno']).toBe('./src/ui/uno.ts')
    expect(manifest.dependencies['markstream-vue']).toBeDefined()
    expect(manifest.dependencies['@vue/devtools-client']).toBeUndefined()
    expect(manifest.dependencies['@vue/devtools-core']).toBeUndefined()
    const entry = ts.createSourceFile('index.ts', readFileSync(resolve(root, 'src/index.ts'), 'utf8'), ts.ScriptTarget.Latest)
    expect(entry.statements.every(statement => ts.isExportDeclaration(statement) && statement.isTypeOnly)).toBe(true)
  })

  it('keeps browser implementations independent of the host and Node runtime', () => {
    const ui = resolve(root, 'src/ui')
    const files = readdirSync(ui, { recursive: true, encoding: 'utf8' }).filter(file => (file.endsWith('.ts') || file.endsWith('.vue')) && file !== 'uno.ts')
    for (const file of files) {
      const source = readFileSync(resolve(ui, file), 'utf8')
      const script = file.endsWith('.vue') ? parse(source).descriptor.scriptSetup?.content ?? '' : source
      const ast = ts.createSourceFile(file, script, ts.ScriptTarget.Latest)
      for (const statement of ast.statements) {
        if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier))
          continue
        const specifier = statement.moduleSpecifier.text
        for (const forbidden of ['node:', '~/', '@vue/devtools-client', '@vue/devtools-core', '@vue/devtools-kit'])
          expect(specifier.startsWith(forbidden), file).toBe(false)
        if (specifier.startsWith('.')) {
          const target = resolve(ui, file, '..', specifier)
          expect(['ui', 'schema'].some(directory => target === resolve(root, 'src', directory) || target.startsWith(`${resolve(root, 'src', directory)}/`)), file).toBe(true)
        }
      }
    }
  })
})
