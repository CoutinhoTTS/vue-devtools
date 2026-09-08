import type { AgentChatSend, ComposerContext, PermissionResponse, SessionOptions, UserInputResponse } from '@vue/devtools-acp'
import type { RpcFunctionCtx } from './types'
import { createAgentChatService, createProviderCatalog } from '@vue/devtools-acp/node'
import { createAgentAuthorization } from './agent-auth'

export function getAgentFunctions(ctx: RpcFunctionCtx) {
  const catalog = createProviderCatalog(ctx.config.root)
  const chat = createAgentChatService(ctx.config.root)
  const auth = createAgentAuthorization()
  const invalidate = (path: string) => {
    if (!path.split(/[\\/]/).some(part => ['.vue-devtools', 'node_modules', '.git', 'dist', 'build'].includes(part)))
      chat.invalidateComposer()
  }
  ctx.server.watcher.on('add', invalidate).on('unlink', invalidate).on('addDir', invalidate).on('unlinkDir', invalidate).on('change', invalidate)
  ctx.server.middlewares.use(`${ctx.config.base}__vue_devtools_agent_auth`, auth.middleware)
  ctx.server.httpServer?.once('close', () => {
    ctx.server.watcher.off('add', invalidate).off('unlink', invalidate).off('addDir', invalidate).off('unlinkDir', invalidate).off('change', invalidate)
    void chat.close()
  })
  return {
    getAgentCommands(token: string, context: ComposerContext, refresh = false) {
      auth.check(token)
      return chat.commands(context, refresh)
    },
    getAgentFiles(token: string, query: string) {
      auth.check(token)
      return chat.searchFiles(query)
    },
    getAgentSessions(token: string) {
      auth.check(token)
      return chat.list()
    },
    sendAgentMessage(token: string, input: AgentChatSend) {
      auth.check(token)
      return chat.send(input)
    },
    stopAgentMessage(token: string, id: string) {
      auth.check(token)
      return chat.stop(id)
    },
    respondAgentPermission(token: string, id: string, response: PermissionResponse) {
      auth.check(token)
      return chat.permission(id, response)
    },
    respondAgentQuestion(token: string, id: string, response: UserInputResponse) {
      auth.check(token)
      return chat.answer(id, response)
    },
    updateAgentOptions(token: string, id: string, options: SessionOptions) {
      auth.check(token)
      return chat.options(id, options)
    },
    getAgentDetections: () => catalog.detect(),
    getAgentModels(provider: string, refresh = false) {
      if (typeof provider !== 'string' || typeof refresh !== 'boolean')
        throw new Error('Invalid catalog request')
      return catalog.probe(provider, refresh)
    },
  }
}
