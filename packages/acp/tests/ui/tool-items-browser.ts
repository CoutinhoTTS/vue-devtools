import { createRequire } from 'node:module'

async function main() {
  if (!process.env.PLAYWRIGHT_MODULE)
    throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright package')
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 850 })
      for (const theme of ['light', 'dark']) {
        await page.goto(`${process.env.COMPOSER_PREVIEW_URL ?? 'http://127.0.0.1:5176/tests/ui/preview.html'}?tool-items&theme=${theme}`)
        await page.locator('[data-message-id="tool-assistant-2"] .acp-tool-group-summary').waitFor()
        if (await page.locator('.acp-messages-content > .acp-tools').count())
          throw new Error('Tools are still rendered below all messages')
        const ownership = await page.locator('.acp-tool').evaluateAll((tools: HTMLElement[]) => tools.map(tool => ({ id: tool.dataset.toolId, owner: tool.closest<HTMLElement>('[data-message-id]')?.dataset.messageId })))
        if (JSON.stringify(ownership) !== JSON.stringify([{ id: 'read-app', owner: 'tool-assistant-1' }, { id: 'read-package', owner: 'tool-assistant-1' }, { id: 'read-routes', owner: 'tool-assistant-2' }]))
          throw new Error(`Tool ownership mismatch: ${JSON.stringify(ownership)}`)
        const order = await page.locator('[data-message-id="tool-assistant-1"]').evaluate((message: HTMLElement) => Array.from(message.children).slice(0, 3).map(child => child.textContent))
        if (order[0] !== 'Checking App.vue.' || !order[1].includes('cat src/App.vue') || order[2] !== 'The entry uses RouterView.')
          throw new Error('Tool block is out of sequence')
        const summary = page.locator('[data-message-id="tool-assistant-1"] .acp-tool-group-summary')
        if ((await summary.textContent()).includes('cat src') || !(await summary.textContent()).includes('2 项调用'))
          throw new Error('Group title is not unified')
        if (await page.locator('[data-tool-id="read-app"]').isVisible())
          throw new Error('Raw commands should be collapsed initially')
        await page.screenshot({ path: `/tmp/devtools-tool-groups-collapsed-${width}-${theme}.png` })
        await summary.click()
        await page.locator('[data-tool-id="read-app"]').waitFor()
        await page.locator('[data-tool-id="read-package"]').waitFor()
        await page.screenshot({ path: `/tmp/devtools-tool-items-${width}-${theme}.png` })
        console.log('PASS message-owned execution', width, theme)
      }
    }
  }
  finally { await browser.close() }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
