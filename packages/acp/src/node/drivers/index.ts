import type { DriverEvent, DriverStartOptions } from '../../schema'
import { isAbsolute } from 'node:path'
import { AcpDriver } from './acp'
import { ClaudeDriver } from './claude'
import { CodexDriver } from './codex'
import { OpenCodeDriver } from './open-code'
import { PiDriver } from './pi'
import { DriverError } from './process'

export async function startAgentDriver(options: DriverStartOptions, emit: (event: DriverEvent) => void) {
  if (!isAbsolute(options.cwd) || (options.binaryPath && !isAbsolute(options.binaryPath)))
    throw new DriverError('invalidRequest', 'cwd and binary overrides must be absolute paths')
  if (options.providerCursor && options.providerCursor.provider !== options.provider)
    throw new DriverError('resumeFailed', 'Provider and native cursor do not match')
  const config = structuredClone(options)
  const Driver = config.provider === 'codex' ? CodexDriver : config.provider === 'kimi' || config.provider === 'grok' ? AcpDriver : config.provider === 'claude' ? ClaudeDriver : config.provider === 'pi' ? PiDriver : config.provider === 'openCode' ? OpenCodeDriver : undefined
  if (!Driver)
    throw new DriverError('unsupported', `Provider is not implemented: ${config.provider}`)
  const driver = new Driver(config, emit)
  try {
    await driver.initialize()
    return driver
  }
  catch (error) {
    await driver.close()
    if (options.providerCursor)
      throw new DriverError('resumeFailed', error instanceof Error ? error.message : 'Session restore failed')
    throw error
  }
}
export { DriverError } from './process'
