import { describe, expect, it } from 'vitest'
import { commandDisplay, pinnedSubmission } from '../../src/ui/command-pin'

describe('command pin serialization', () => {
  const command = { id: 'codex:skill:review', name: 'review', kind: 'skill' as const }
  it('keeps native command text and reference offsets while editing only arguments', () => {
    const submission = pinnedSubmission('Read @file.ts', command, [{ path: 'file.ts', start: 5, end: 13 }])
    expect(submission).toEqual({ content: '/review Read @file.ts', command, references: [{ path: 'file.ts', start: 13, end: 21 }] })
    expect(commandDisplay(submission.content, command)).toEqual({ text: 'Read @file.ts', command, prefixLength: 8 })
    expect(pinnedSubmission('', command).content).toBe('/review ')
  })
  it('supports legacy slash history without interpreting paths or mismatched metadata', () => {
    expect(commandDisplay('/4.0-app-router').command?.name).toBe('4.0-app-router')
    expect(commandDisplay('/plugin:skill\nnext').text).toBe('\nnext')
    expect(commandDisplay('/src/file.ts').command).toBeUndefined()
    expect(commandDisplay('Discuss /review').command).toBeUndefined()
    expect(commandDisplay('/other', command).command).toBeUndefined()
  })
})
