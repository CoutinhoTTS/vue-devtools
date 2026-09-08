import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'

export function isLocalAgentRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  if (!(address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1'))
    return false
  try {
    const host = new URL(`http://${req.headers.host}`)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname))
      return false
    if (req.headers.origin && new URL(req.headers.origin).host !== host.host)
      return false
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))
      return false
    return true
  }
  catch { return false }
}

export function createAgentAuthorization() {
  const token = randomBytes(32).toString('hex')
  return {
    middleware(req: IncomingMessage, res: ServerResponse) {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'application/json')
      if (req.method !== 'POST' || req.headers['x-vue-devtools-agent'] !== '1' || !isLocalAgentRequest(req)) {
        res.statusCode = 403
        res.end(JSON.stringify({ error: 'Agent access requires a same-origin localhost connection' }))
        return
      }
      res.end(JSON.stringify({ token }))
    },
    check(value: unknown) {
      if (typeof value !== 'string' || value.length !== token.length || !timingSafeEqual(Buffer.from(value), Buffer.from(token)))
        throw new Error('Agent access denied. Reconnect to the local development server.')
    },
  }
}
