// Generates branded Open Graph share cards (1200x630 PNG) for Discord/Twitter
// unfurls. Renders an on-brand SVG with the real Archivo / Hanken Grotesk fonts
// via resvg. Run: node scripts/gen-og.mjs
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const FONTS = [join(__dir, 'og-fonts/Archivo.ttf'), join(__dir, 'og-fonts/HankenGrotesk.ttf')]

const INK = '#0a0c11'
const INK2 = '#12151c'
const WHITE = '#f7f8fa'
const MUTED = '#9aa1ad'
const BRAND = '#f2e114'
const BLUE = '#4F8DF0'
const GREEN = '#4ADE80'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Read the Daytona circuit path from the generated track-maps file to use as a
 * subtle watermark (ties the card to the site's track-map feature). */
function daytonaPath() {
  try {
    const src = readFileSync(join(root, 'src/lib/trackMaps.ts'), 'utf8')
    const block = src.split('"Daytona Road Course"')[1] ?? ''
    const m = block.match(/path:\s*'([^']+)'/)
    const vb = block.match(/viewBox:\s*'([^']+)'/)
    if (m && vb) return { d: m[1], viewBox: vb[1] }
  } catch {}
  return null
}

function chip(x, y, label, color, dark = true) {
  const w = 34 + label.length * 20
  return `
    <g transform="translate(${x} ${y})">
      <rect width="${w}" height="52" rx="26" fill="${color}" opacity="${dark ? 1 : 0.16}"/>
      <circle cx="27" cy="26" r="7" fill="${dark ? INK : color}"/>
      <text x="46" y="35" font-family="Hanken Grotesk" font-weight="700" font-size="24"
        letter-spacing="1" fill="${dark ? INK : WHITE}">${esc(label)}</text>
    </g>`
}

function card({ eyebrow, title, subtitle, chips = true }) {
  const W = 1200
  const H = 630
  const track = daytonaPath()
  // faint telemetry gridlines
  let grid = ''
  for (let gx = 0; gx <= W; gx += 60) grid += `<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="#ffffff" stroke-opacity="0.03"/>`
  for (let gy = 0; gy <= H; gy += 60) grid += `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="#ffffff" stroke-opacity="0.03"/>`

  // title can wrap onto 2 lines (split on the space closest to middle if long)
  const titleLines = title.length > 15 ? wrap(title, 15) : [title]
  const titleFS = titleLines.length > 1 ? 96 : 128
  let titleSvg = ''
  titleLines.forEach((ln, i) => {
    titleSvg += `<text x="90" y="${300 + i * (titleFS + 6)}" font-family="Archivo" font-weight="900" font-size="${titleFS}" letter-spacing="-2" fill="${WHITE}">${esc(ln.toUpperCase())}</text>`
  })
  const afterTitleY = 300 + (titleLines.length - 1) * (titleFS + 6)

  const watermark = track
    ? `<g transform="translate(760 150)" opacity="0.5">
         <svg width="520" height="380" viewBox="${track.viewBox}" fill="none" preserveAspectRatio="xMidYMid meet">
           <path d="${track.d}" stroke="${BRAND}" stroke-opacity="0.22" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
         </svg>
       </g>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <radialGradient id="glow" cx="82%" cy="26%" r="60%">
        <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="${BRAND}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${INK}"/>
        <stop offset="100%" stop-color="${INK2}"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${grid}
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    ${watermark}
    <rect x="0" y="0" width="12" height="${H}" fill="${BRAND}"/>

    <!-- header lockup -->
    <g transform="translate(90 78)">
      <rect width="60" height="60" rx="16" fill="${BRAND}"/>
      <text x="30" y="40" text-anchor="middle" font-family="Archivo" font-weight="900" font-size="24" fill="${INK}">HCR</text>
      <text x="80" y="41" font-family="Archivo" font-weight="800" font-size="30" letter-spacing="1" fill="${WHITE}">HCR LEAGUE</text>
    </g>

    <text x="90" y="200" font-family="Hanken Grotesk" font-weight="700" font-size="26" letter-spacing="4" fill="${BRAND}">${esc(eyebrow.toUpperCase())}</text>
    ${titleSvg}
    <text x="92" y="${afterTitleY + 62}" font-family="Hanken Grotesk" font-weight="500" font-size="32" fill="${MUTED}">${esc(subtitle)}</text>

    ${chips ? `<g transform="translate(90 ${H - 96})">
      ${chip(0, 0, 'GTP', BRAND)}
      ${chip(150, 0, 'LMP2', BLUE, false)}
      ${chip(330, 0, 'GTD', GREEN, false)}
    </g>` : ''}
  </svg>`
}

function wrap(text, target) {
  const words = text.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > target && cur) {
      lines.push(cur.trim())
      cur = w
    } else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 2)
}

function render(svg, outfile) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Archivo' },
    background: INK,
  })
  const png = resvg.render().asPng()
  mkdirSync(dirname(outfile), { recursive: true })
  writeFileSync(outfile, png)
  console.log('wrote', outfile, (png.length / 1024).toFixed(0) + 'KB')
}

// Default + per-section cards. The Netlify edge function maps routes to these.
const CARDS = {
  'og-default': { eyebrow: '2026 Season · iRacing Endurance', title: 'HCR League', subtitle: 'Three-class endurance racing — GTP · LMP2 · GTD' },
  'og-schedule': { eyebrow: '2026 Season · 11 Rounds', title: 'Schedule', subtitle: 'The full HCR League endurance calendar' },
  'og-standings': { eyebrow: '2026 Season · Championship', title: 'Standings', subtitle: 'GTP · LMP2 · GTD points and progression' },
  'og-results': { eyebrow: '2026 Season · Race Control', title: 'Results', subtitle: 'Race-by-race class classifications' },
  'og-roster': { eyebrow: 'HCR League', title: 'Roster', subtitle: 'Drivers and teams of the championship' },
  'og-signup': { eyebrow: 'Now Enrolling', title: 'Enter Season', subtitle: 'Claim your seat on the 2026 HCR League grid' },
}
for (const [name, cfg] of Object.entries(CARDS)) {
  render(card(cfg), join(root, `public/${name}.png`))
}
