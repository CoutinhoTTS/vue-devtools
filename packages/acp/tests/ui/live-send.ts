import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'
import VueDevTools from '../../../vite/src/vite'

/** Explicit, opt-in browser-to-agent test. Uses installed CLI authentication. */
async function main() {
  const require = createRequire(import.meta.url)
  const playwrightPath = process.env.PLAYWRIGHT_MODULE
  if (!playwrightPath)
    throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright module')
  const { chromium } = require(playwrightPath)
  const root = await mkdtemp(resolve(tmpdir(), 'acp-browser-send-'))
  const repo = resolve(import.meta.dirname, '../../../..')
  const server = await createServer({ configFile: false, root, resolve: { alias: { vue: resolve(repo, 'node_modules/vue/dist/vue.esm-bundler.js') } }, server: { host: '127.0.0.1', port: 5179, fs: { allow: [repo, root] } }, plugins: [Vue(), VueDevTools(), { name: 'test-document', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== '/')
        return next()
      const html = `<!doctype html><html><body><div id="app"></div><script type="module">import {createApp,h} from "/@fs/${repo}/node_modules/vue/dist/vue.esm-bundler.js";createApp({render:()=>h("h1","Agent connection test")}).mount("#app")</script></body></html>`
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/', html))
    })
  } }] })
  let browser: any
  try {
    await server.listen()
    const address = server.httpServer!.address() as { port: number }
    const url = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
    page.on('pageerror', (error: Error) => console.log('PAGE ERROR', error.message))
    await page.goto(url)
    await page.waitForTimeout(1500)
    console.log('FRAMES', page.frames().map((f: any) => f.url()))
    // Open the embedded devtools panel with its documented shortcut.
    await page.keyboard.press('Alt+Shift+D')
    const frame = page.frameLocator('iframe')
    await frame.locator('a[href="/acp"]').click({ timeout: 15000 })
    await frame.locator('.acp-connection.connected').waitFor({ timeout: 15000 })
    const agent = process.argv[2] ?? 'Kimi'
    if (agent !== 'Kimi') {
      await frame.locator('.acp-control').nth(0).locator('button').click()
      await frame.getByRole('button', { name: agent, exact: true }).last().click()
    }
    await page.waitForTimeout(1200)
    await frame.locator('.acp-control').nth(1).locator('button').click()
    await frame.getByRole('button', { name: 'deepseek-v4-pro', exact: true }).last().click()
    const marker = 'BROWSER_AGENT_OK'
    await frame.getByRole('textbox', { name: 'Message', exact: true }).fill(`Reply exactly ${marker}. Do not use tools or read files.`)
    await frame.getByRole('button', { name: 'Send message', exact: true }).click()
    await frame.locator('.acp-message.user').waitFor({ timeout: 1000 })
    console.log('USER MESSAGE visible immediately')
    await frame.locator('.acp-message.assistant').filter({ hasText: marker }).waitFor({ timeout: 90000 })
    console.log('ASSISTANT', await frame.locator('.acp-message.assistant').textContent())
    console.log('SESSIONS', await frame.locator('.acp-session-item').count())
    await page.screenshot({ path: '/tmp/acp-live-send.png' })
    await frame.getByRole('button', { name: 'Send message', exact: true }).waitFor()
    await page.reload()
    await page.waitForTimeout(1500)
    if (!await frame.locator('a[href="/acp"]').isVisible())
      await page.keyboard.press('Alt+Shift+D')
    await frame.locator('a[href="/acp"]').click({ timeout: 15000 })
    await frame.locator('.acp-session-item').first().click({ timeout: 15000 })
    await frame.locator('.acp-message.assistant').filter({ hasText: marker }).waitFor()
    console.log(`PASS: Browser -> Vite RPC -> local ${agent} -> reply; history survives reload`)
  }
  finally {
    await browser?.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
