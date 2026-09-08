import { createRequire } from 'node:module'
import { resolve } from 'node:path'

async function main() {
  const require = createRequire(import.meta.url)
  if (!process.env.PLAYWRIGHT_MODULE)
    throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright package')
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const errors: string[] = []
  try {
    const page = await browser.newPage()
    page.on('pageerror', (error: Error) => errors.push(error.message))
    for (const [width, height] of [[1440, 950], [390, 844]]) {
      await page.setViewportSize({ width, height })
      for (const theme of ['light', 'dark']) {
        await page.goto(`${process.env.COMPOSER_PREVIEW_URL ?? 'http://127.0.0.1:5176/tests/ui/preview.html'}?empty&theme=${theme}`)
        const input = page.getByRole('combobox', { name: 'Message' })
        for (const [draft, expectedHeight] of [['', 24], ['Short message', 24], ['line\n'.repeat(30), 240], ['', 24]] as const) {
          await input.fill(draft)
          await page.waitForFunction((height: number) => document.querySelector('.acp-composer-editor')?.getBoundingClientRect().height === height, expectedHeight)
        }
        const spacing = await input.evaluate((editor: HTMLElement) => {
          const bounds = editor.getBoundingClientRect()
          const actions = editor.parentElement!.querySelector('.acp-input-actions')!.getBoundingClientRect()
          return { gap: actions.top - bounds.bottom, left: bounds.left, right: bounds.right }
        })
        if (spacing.gap !== 12 || spacing.left < 0 || spacing.right > width)
          throw new Error(`Unexpected composer spacing: ${JSON.stringify(spacing)}`)
        await page.screenshot({ path: resolve('/tmp', `devtools-composer-compact-${width}-${theme}.png`) })
        await input.fill('/rev')
        const choice = page.getByRole('option').filter({ hasText: '/review-code' })
        await choice.waitFor()
        await input.press('Enter')
        if (await input.getAttribute('contenteditable') !== 'true' || await input.locator('[contenteditable="false"] .acp-pin-label').textContent() !== 'review-code')
          throw new Error('Enter did not accept the command')
        if (await page.locator('.acp-message.user').count())
          throw new Error('Completion sent a message')
        await page.keyboard.insertText('Inspect ')
        const inline = await input.evaluate((editor: HTMLElement) => {
          const pin = editor.querySelector('[data-command-pin]')!
          const text = Array.from(editor.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Inspect'))!
          const range = document.createRange()
          range.selectNodeContents(text)
          const bounds = range.getBoundingClientRect()
          const pinBounds = pin.getBoundingClientRect()
          return { adjacent: bounds.left >= pinBounds.right, sameLine: Math.abs(bounds.bottom - pinBounds.bottom) < 12 }
        })
        if (!inline.adjacent || !inline.sameLine)
          throw new Error('Text is not inline after the pin')
        await input.press('Shift+Enter')
        await page.keyboard.insertText('@')
        await page.getByRole('option').filter({ hasText: 'Project notes' }).waitFor()
        const box = await page.locator('.acp-suggestions').boundingBox()
        const inputBox = await input.boundingBox()
        if (!box || !inputBox || box.x < 0 || box.y < 0 || box.x + box.width > width || box.y + box.height > inputBox.y)
          throw new Error('Suggestions are clipped or overlap the input')
        await page.screenshot({ path: resolve('/tmp', `devtools-composer-${width}-${theme}.png`) })
        await page.getByRole('option').filter({ hasText: 'Project notes' }).click()
        if (!(await input.textContent()).includes('@"docs/Project notes.md"'))
          throw new Error('File reference was not quoted')
        await input.fill('/')
        await page.getByRole('listbox').waitFor()
        await input.press('Escape')
        if (await page.getByRole('listbox').count())
          throw new Error('Escape did not dismiss suggestions')
        await input.fill('Keep these arguments')
        if (await input.locator('[data-command-pin]').count())
          throw new Error('Replacing all editor content retained the pin')
        await input.fill('/rev')
        await choice.waitFor()
        await input.press('Enter')
        await input.press('Backspace')
        if (!await page.locator('.acp-command-pin.armed').count())
          throw new Error('Empty Backspace did not select the pin')
        await input.press('Backspace')
        if (await input.locator('[data-command-pin]').count())
          throw new Error('Second Backspace did not remove the pin')
        console.log('PASS', width, height, theme)
      }
    }
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1100, height: 760 })
      await page.goto(`${process.env.COMPOSER_PREVIEW_URL ?? 'http://127.0.0.1:5176/tests/ui/preview.html'}?long&theme=${theme}`)
      const input = page.getByRole('combobox', { name: 'Message' })
      await input.fill('/')
      const menu = page.locator('.acp-suggestions')
      await menu.getByRole('group', { name: 'Skills', exact: true }).waitFor()
      if (await menu.locator('.acp-suggestion-heading').allTextContents().then((labels: string[]) => labels.join(',')) !== 'Application,Agent Commands,Skills')
        throw new Error('Command grouping changed')
      if ((await menu.textContent()).includes('Hidden skill description') || (await menu.textContent()).includes('Review the selected changes'))
        throw new Error('Skill descriptions are still rendered')
      await page.evaluate(() => {
        const menu = document.querySelector('.acp-suggestions')!.getBoundingClientRect()
        const button = document.querySelector<HTMLElement>('.acp-message-actions button')!
        Object.assign(button.style, { position: 'fixed', left: `${menu.left + 20}px`, top: `${menu.top + 100}px`, zIndex: '999999' })
      })
      const layering = await page.evaluate(() => {
        const menu = document.querySelector('.acp-suggestions')!
        const bounds = menu.getBoundingClientRect()
        const style = getComputedStyle(menu)
        const at = document.elementFromPoint(bounds.left + 30, bounds.top + 110)
        return { covered: !!at && menu.contains(at), background: style.backgroundColor, opacity: style.opacity }
      })
      if (!layering.covered || layering.background.startsWith('rgba') || layering.opacity !== '1')
        throw new Error(`Messages bleed through the suggestions: ${JSON.stringify(layering)}`)
      await page.screenshot({ path: resolve('/tmp', `devtools-grouped-suggestions-${theme}.png`) })
      await input.press('ArrowDown')
      await input.press('ArrowDown')
      await input.press('Enter')
      if (await input.locator('[data-command-pin]').getAttribute('data-command-name') !== 'review-code')
        throw new Error('Keyboard navigation selected a group header or wrong command')
      console.log('PASS grouped menu and stacking', theme)
    }
    if (errors.length)
      throw new Error(errors.join('\n'))
  }
  finally { await browser.close() }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
