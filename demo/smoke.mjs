import { attach, launchChrome, sleep } from './cdp.mjs'
const BASE = 'http://127.0.0.1:8080'
const { child, port } = await launchChrome({ port: 9612, width: 1440, height: 900 })
const page = await attach(port)
async function key(name, { shift = false } = {}) {
  const map = {
    Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' },
    Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' },
    Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter' },
  }
  const base = map[name]
  const modifiers = shift ? 8 : 0
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, ...base })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...base })
  await sleep(70)
}
const active = () => page.eval(`(() => {
  const el = document.activeElement
  if (!el || el === document.body) return { tag: 'BODY' }
  return {
    tag: el.tagName, cls: String(el.className).slice(0,50), id: el.id,
    text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
    inInfo: !!el.closest('.map-info'), inCanvas: !!el.closest('.map-canvas'),
    inPin: !!el.closest('.map-pin'),
  }
})()`)
try {
  await page.goto(`${BASE}/login/`, { settle: 700 })
  await page.type('input[name="email"]', 'demo@example.test', { perChar: 0 })
  await page.type('input[name="password"]', 'demo-nur-lokal-2026', { perChar: 0 })
  await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
  await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: 'dashboard' })
  await sleep(4500)

  // open the first Objektliste row's panel with the keyboard
  console.log('--- open via Objektliste "Öffnen" ---')
  const opened = await page.eval(`(() => {
    const b = [...document.querySelectorAll('table.objects-table tbody tr')][0]
      .querySelector('.cell-actions button')
    window.__opener = b; b.focus(); b.click(); return b.textContent.trim()
  })()`)
  await sleep(1200)
  console.log('opener:', opened)
  console.log(await page.eval(`(() => ({
    infoBoxes: document.querySelectorAll('.map-info').length,
    drawers: document.querySelectorAll('.drawer').length,
    active: document.activeElement.tagName + ' ' + (document.activeElement.textContent||'').trim().slice(0,30),
    search: location.search,
  }))()`))

  console.log('--- tab forward 8 from opener ---')
  for (let i = 0; i < 8; i++) { await key('Tab'); console.log(i + 1, JSON.stringify(await active())) }

  console.log('--- shift-tab back 20 from opener ---')
  await page.eval(`window.__opener.focus()`)
  for (let i = 0; i < 20; i++) { await key('Tab', { shift: true }); const a = await active(); console.log(i + 1, JSON.stringify(a)); if (a.inInfo) break }

  console.log('--- info box contents ---')
  console.log(await page.eval(`(() => {
    const box = document.querySelector('.map-info')
    if (!box) return null
    return {
      label: box.getAttribute('aria-label'), role: box.getAttribute('role'),
      links: [...box.querySelectorAll('a')].map(a => a.getAttribute('href')),
      buttons: [...box.querySelectorAll('button')].map(b => b.textContent.trim().slice(0,30)),
      tabbables: box.querySelectorAll('a[href],button,[tabindex]:not([tabindex="-1"])').length,
    }
  })()`))
  console.log('--- escape? ---')
  await key('Escape')
  await sleep(400)
  console.log(await page.eval(`({ boxes: document.querySelectorAll('.map-info').length, search: location.search })`))
} finally {
  page.close(); child.kill()
}
