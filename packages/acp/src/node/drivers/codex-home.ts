import { homedir } from 'node:os'
import { join } from 'node:path'

/** Never inherit the desktop application's CODEX_HOME. */
export function codexCliHome(home = homedir()) {
  return process.env.VUE_DEVTOOLS_CODEX_HOME ?? join(home, '.vue-devtools/codex')
}

export function codexCliEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env, CODEX_HOME: codexCliHome(), OCX_SHIM_BYPASS: '1' }
  for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID', 'CODEX_API_KEY']) delete env[name as keyof typeof env]
  return env
}
