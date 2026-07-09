// Build clean circuit outlines from OpenStreetMap Overpass -> single stitched
// SVG loop per track. Raw Overpass responses are cached under scripts/.osm-cache
// so the geometry assembly can be re-run offline (delete the cache to refetch).
//
// Assembly: fetch all `highway=raceway` ways near the track, drop pit lanes /
// kart tracks / paddock service roads, chain ways that share endpoints into
// connected components, keep the longest component (the main circuit), and close
// it into a loop. © OpenStreetMap contributors, ODbL.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CACHE = 'scripts/.osm-cache'
mkdirSync(CACHE, { recursive: true })

// [name, lat, lon, searchRadius(m)]. Radius tuned so long circuits are fully
// covered without swallowing neighbouring tracks.
const TRACKS = [
  ['Belle Isle', 42.3298, -82.9962, 2500],
  ['Canadian Tire Motorsport Park', 44.0512, -78.6769, 2500],
  ['Daytona Road Course', 29.1852, -81.0699, 3000],
  ['Indianapolis Motor Speedway', 39.7951, -86.2349, 2500],
  ['Laguna Seca', 36.5844, -121.7533, 2500],
  ['Long Beach Street Circuit', 33.7648, -118.1888, 2500],
  ['Road America', 43.7981, -87.9895, 3500],
  ['Road Atlanta', 34.1479, -83.8163, 2500],
  ['Sebring International Raceway', 27.4536, -81.3483, 3000],
  ['Virginia International Raceway', 36.5599, -79.2068, 3500],
  ['Watkins Glen International', 42.3369, -76.9272, 2500],
]

const EP = 'https://overpass-api.de/api/interpreter'
const Q = (lat, lon, r) => `[out:json][timeout:120];(way["highway"="raceway"](around:${r},${lat},${lon}););out geom tags;`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass(q, tries = 5) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(EP, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'HCR-League-Site/1.0 (league track maps; zackdbrown03@gmail.com)',
          Accept: 'application/json',
        },
        body: 'data=' + encodeURIComponent(q),
      })
      if (!res.ok) { lastErr = new Error(res.status); await sleep(6000); continue }
      return await res.json()
    } catch (e) { lastErr = e; await sleep(6000) }
  }
  throw lastErr
}

async function getRaw(name, lat, lon, r) {
  const f = join(CACHE, name.replace(/[^a-z0-9]+/gi, '_') + '.json')
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'))
  const j = await overpass(Q(lat, lon, r))
  writeFileSync(f, JSON.stringify(j))
  await sleep(3500)
  return j
}

// --- geometry helpers ---
const m = (a, b) => {
  const dLat = (a.lat - b.lat) * 111000
  const dLon = (a.lon - b.lon) * 111000 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}
const key = (c) => c.lat.toFixed(6) + ',' + c.lon.toFixed(6)
const wayLen = (g) => g.reduce((s, c, i) => (i ? s + m(g[i - 1], c) : 0), 0)

// A raceway way we should ignore (pit lane, kart track, service road, etc.)
function isNoise(w) {
  const t = w.tags || {}
  if (t.raceway === 'pitlane' || t.raceway === 'paddock') return true
  if (t.sport === 'karting' || t.name?.toLowerCase().includes('kart')) return true
  if (t.service || t.access === 'private') return true
  if (t.area === 'yes') return true
  return false
}

/** Greedily chain ways that share endpoints, extracting every connected chain. */
function components(ways) {
  const pool = ways.map((w) => w.geometry.slice())
  const chains = []
  while (pool.length) {
    let chain = pool.shift()
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i]
        const head = chain[0]
        const tail = chain[chain.length - 1]
        const ws = w[0]
        const we = w[w.length - 1]
        if (key(tail) === key(ws)) { chain = chain.concat(w.slice(1)); pool.splice(i, 1); grew = true; break }
        if (key(tail) === key(we)) { chain = chain.concat(w.slice(0, -1).reverse()); pool.splice(i, 1); grew = true; break }
        if (key(head) === key(we)) { chain = w.slice(0, -1).concat(chain); pool.splice(i, 1); grew = true; break }
        if (key(head) === key(ws)) { chain = w.slice(1).reverse().concat(chain); pool.splice(i, 1); grew = true; break }
      }
    }
    chains.push(chain)
  }
  return chains
}

/**
 * Graph-based clean loop: treat each way as an edge between its two endpoint
 * nodes, iteratively delete degree-1 nodes (this strips every dead-end spur —
 * pit lanes, paddock roads, access tracks all terminate) until only the cyclic
 * core remains, then walk the largest connected core into one ordered loop.
 * Returns null if there's no cycle (e.g. an incomplete street circuit).
 */
function loopFromGraph(ways) {
  // snap endpoints that are within ~12m to a shared node id (OSM circuits often
  // meet at endpoints a few cm/m apart rather than an identical node)
  const centers = []
  const nodeId = (c) => {
    for (let i = 0; i < centers.length; i++) if (m(centers[i], c) < 12) return i
    centers.push(c)
    return centers.length - 1
  }
  // build edges keyed by snapped endpoint nodes
  let edges = ways
    .map((w, id) => ({ id, a: nodeId(w.geometry[0]), b: nodeId(w.geometry[w.geometry.length - 1]), pts: w.geometry }))
    .filter((e) => e.a !== e.b || e.pts.length > 3) // drop degenerate

  // iteratively remove leaves (degree-1 nodes)
  for (;;) {
    const deg = new Map()
    for (const e of edges) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1) }
    const before = edges.length
    edges = edges.filter((e) => (e.a === e.b) || (deg.get(e.a) > 1 && deg.get(e.b) > 1))
    if (edges.length === before) break
    if (!edges.length) return null
  }
  if (!edges.length) return null

  // adjacency for walking
  const adj = new Map()
  const push = (n, e) => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(e) }
  for (const e of edges) { push(e.a, e); if (e.a !== e.b) push(e.b, e) }

  // walk the largest cycle: start from the node on the longest edge, always
  // take the longest unused edge (favours the main straight over chords)
  const used = new Set()
  const startEdge = edges.slice().sort((x, y) => wayLen(y.pts) - wayLen(x.pts))[0]
  let node = startEdge.a
  const loop = []
  for (;;) {
    const opts = (adj.get(node) || []).filter((e) => !used.has(e.id))
    if (!opts.length) break
    opts.sort((x, y) => wayLen(y.pts) - wayLen(x.pts))
    const e = opts[0]
    used.add(e.id)
    const oriented = e.a === node ? e.pts : e.pts.slice().reverse()
    for (let i = loop.length ? 1 : 0; i < oriented.length; i++) loop.push(oriented[i])
    node = e.a === node ? e.b : e.a
  }
  return loop.length > 20 ? loop : null
}

/** Chaikin corner-cutting: smooths GPS jitter into clean flowing curves. */
function smooth(pts, iters = 3, closed = false) {
  let p = pts
  for (let it = 0; it < iters; it++) {
    const out = []
    if (!closed) out.push(p[0])
    const n = p.length
    const last = closed ? n : n - 1
    for (let i = 0; i < last; i++) {
      const a = p[i]
      const b = p[(i + 1) % n]
      out.push({ lat: a.lat * 0.75 + b.lat * 0.25, lon: a.lon * 0.75 + b.lon * 0.25 })
      out.push({ lat: a.lat * 0.25 + b.lat * 0.75, lon: a.lon * 0.25 + b.lon * 0.75 })
    }
    if (!closed) out.push(p[n - 1])
    p = out
  }
  return p
}

function toPath(chain) {
  const latMean = chain.reduce((s, c) => s + c.lat, 0) / chain.length
  const k = Math.cos((latMean * Math.PI) / 180)
  const px = (c) => c.lon * k
  const py = (c) => -c.lat
  const xs = chain.map(px)
  const ys = chain.map(py)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const w = maxX - minX || 1
  const h = maxY - minY || 1
  const scale = 1000 / Math.max(w, h)
  const pad = 60
  const X = (c) => ((px(c) - minX) * scale + pad).toFixed(1)
  const Y = (c) => ((py(c) - minY) * scale + pad).toFixed(1)
  const vbW = Math.round(w * scale + pad * 2)
  const vbH = Math.round(h * scale + pad * 2)
  let d = ''
  chain.forEach((c, i) => { d += (i === 0 ? 'M' : 'L') + X(c) + ' ' + Y(c) })
  // close the loop if the ends are within 8% of the circuit's larger dimension
  if (m(chain[0], chain[chain.length - 1]) < Math.max(w, h) / scale === false) {} // no-op guard
  return { d, viewBox: `0 0 ${vbW} ${vbH}`, closed: false }
}

const out = {}
for (const [name, lat, lon, r] of TRACKS) {
  try {
    const j = await getRaw(name, lat, lon, r)
    let ways = (j.elements || []).filter((e) => e.type === 'way' && e.geometry && e.geometry.length > 4)
    const before = ways.length
    ways = ways.filter((w) => !isNoise(w))
    // Build both a graph cycle (spurs stripped) and the greedy longest chain,
    // then keep whichever traces more of the circuit (the main loop is longest).
    const cycle = loopFromGraph(ways)
    const chains = components(ways)
    chains.sort((a, b) => wayLen(b) - wayLen(a))
    const greedy = chains[0]
    if (!cycle && !greedy) { console.log('NONE  ', name); continue }
    // prefer the cycle only when it captures ≥85% of the greedy length (clean loop),
    // otherwise the greedy chain (cycle likely got trapped in a small sub-loop)
    let chain, how
    if (cycle && (!greedy || wayLen(cycle) >= wayLen(greedy) * 0.85)) { chain = cycle; how = 'cycle' }
    else { chain = greedy; how = 'chain' }
    // close the loop when the two ends nearly meet
    const gap = m(chain[0], chain[chain.length - 1])
    const len = wayLen(chain)
    const willClose = gap < len * 0.15
    if (willClose) chain = chain.concat([chain[0]])
    chain = smooth(chain, 3, willClose)
    const { d, viewBox } = toPath(chain)
    out[name] = { path: d, viewBox }
    console.log('OK    ', name.padEnd(32), how, `ways ${before}->${ways.length}`, `pts ${chain.length}`, `len ${(len / 1000).toFixed(2)}km`, willClose ? 'closed' : 'open')
  } catch (e) {
    console.log('ERR   ', name, String(e.message))
  }
}

const ts = `// Auto-generated by scripts/fetch-track-maps.mjs — circuit outlines from OpenStreetMap (© OpenStreetMap contributors, ODbL).
export interface TrackMap { path: string; viewBox: string }
export const TRACK_MAPS: Record<string, TrackMap> = ${JSON.stringify(out, null, 2)}
`
writeFileSync('src/lib/trackMaps.ts', ts)
console.log('\nwrote ' + Object.keys(out).length + ' maps')
