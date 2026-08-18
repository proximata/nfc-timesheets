/**
 * "Is it lighter?" — the tape measure, in ONE place.
 *
 * The owner's complaint was never about source lines. It was: too much text, two stacked
 * white containers, I have to READ a whole screen instead of skimming it. So three numbers
 * per screen, each mapping to one clause of that sentence:
 *
 *   px      documentElement.scrollHeight — how much screen there is
 *   read    WORDS of prose above the first datum — how much you must read before an answer
 *   boxes   stacked surface containers in the main column — the "two white containers"
 *
 * IT LIVES IN ITS OWN FILE BECAUSE TWO CALLERS NEED IT AND A BEFORE/AFTER COMPARISON MADE
 * WITH TWO DIFFERENT RULERS IS NOT A COMPARISON. demo/shoot-ia.mjs takes the reading at the
 * same moment it takes the picture; demo/measure-ia-weight.mjs takes it on both origins in
 * one run. Copy-pasting the walker into the second one is how the two silently drift.
 *
 * THE MAP BREAKS THE NAIVE WALKER, and this is the correction that matters. The Google Maps
 * JS API injects its own keyboard-shortcut `<table>` into the page — width 0, height 0, at
 * y = 0, containing „←Nach links →Nach rechts ↑Nach oben ↓Nach unten". The first version of
 * this walker looked for the first `table` and found THAT, put the first datum at y = 0, and
 * reported `read = 0` for a home screen that plainly carries a question line above its
 * answer band. Zero words is not a light screen, it is a broken measurement, and it would
 * have been reported as the map making the screen easier to read.
 *
 * So the search for the first datum skips anything with no box, and anything inside the map
 * region — which is right on its own terms too: the map is not the screen's first DATUM,
 * it is a picture of where the data is.
 */
export const WEIGHT = `(() => {
  const main = document.querySelector('#main-content, main') || document.body

  const candidates = [...main.querySelectorAll('table, .figure, .answer, [class*=figure], [class*=answer]')]
    .filter((el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return false          // Google's 0x0 shortcut table
      if (el.closest('.map-region, .gm-style')) return false // anything Maps injected
      return true
    })
  const firstY = candidates.length
    ? Math.min(...candidates.map((el) => el.getBoundingClientRect().top + window.scrollY))
    : Infinity

  let words = 0
  const prose = []
  for (const el of main.querySelectorAll('p, li, .note, .hint')) {
    if (el.closest('table')) continue
    if (el.closest('.map-region, .gm-style')) continue
    if (el.getBoundingClientRect().top + window.scrollY >= firstY) continue
    if (!el.offsetParent) continue
    const n = (el.innerText.trim().match(/\\S+/g) || []).length
    words += n
    if (n > 0) prose.push(el.innerText.trim().slice(0, 60))
  }

  const pageBg = getComputedStyle(document.body).backgroundColor
  const boxes = [...main.querySelectorAll('div, section, form, aside')].filter((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (r.width < 300 || r.height < 60) return false
    if (cs.backgroundColor === pageBg || cs.backgroundColor === 'rgba(0, 0, 0, 0)') return false
    const p = el.parentElement?.closest('div,section,form,aside')
    if (!p) return true
    const pbg = getComputedStyle(p).backgroundColor
    return pbg === pageBg || pbg === 'rgba(0, 0, 0, 0)'
  }).length

  return {
    px: document.documentElement.scrollHeight,
    read: words,
    boxes,
    firstDatumY: firstY === Infinity ? null : Math.round(firstY),
    prose,
  }
})()`;
