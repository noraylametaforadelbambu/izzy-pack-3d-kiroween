import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HalloweenDecor } from './HalloweenDecor'

describe('Halloween decoration', () => {
  const html = renderToStaticMarkup(createElement(HalloweenDecor))
  it('is hidden from assistive technology', () => {
    expect(html).toMatch(/^<div class="hwdecor" aria-hidden="true"/)
  })
  it('has the pumpkin with its lit face and exactly two bats', () => {
    expect(html.match(/class="hw-pumpkin"/g)).toHaveLength(1)
    for (const part of ['stem', 'eye a', 'eye b', 'nose', 'mouth']) expect(html).toContain(`class="${part}"`)
    expect(html.match(/class="hw-bat /g)).toHaveLength(2)
  })
  it('is only decoration: no text, no controls, no images, no links, no focusable elements', () => {
    expect(html.replace(/<[^>]*>/g, '')).toBe('') // no visible or readable text
    expect(html).not.toMatch(/<(button|a|input|img|svg|canvas|select|textarea)\b/i)
    expect(html).not.toMatch(/tabindex|role=|onclick|href|src=/i)
  })
})
