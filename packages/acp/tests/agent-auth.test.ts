import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createAgentAuthorization, isLocalAgentRequest } from '../../vite/src/rpc/agent-auth'

const request = (address: string, host: string, origin?: string) => ({ socket: { remoteAddress: address }, headers: { host, origin } }) as IncomingMessage
describe('local agent authorization', () => {
  it('rejects remote clients and cross-origin localhost requests', () => {
    expect(isLocalAgentRequest(request('::1', 'localhost:3000', 'http://localhost:3000'))).toBe(true)
    expect(isLocalAgentRequest(request('192.168.1.2', 'localhost:3000'))).toBe(false)
    expect(isLocalAgentRequest(request('127.0.0.1', 'attacker.example'))).toBe(false)
    expect(isLocalAgentRequest(request('127.0.0.1', 'localhost:3000', 'https://attacker.example'))).toBe(false)
    expect(() => createAgentAuthorization().check('bad')).toThrow('denied')
  })
})
