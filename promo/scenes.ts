// Frame-exact motion graphics for the KitchenIQ promo. draw(t) paints one frame at time t.

import { buildSegments, ballAt } from '../src/lib/ballpath'
import { applyH, courtLines, homographies, NET_Y } from '../src/lib/court'
import { simulateMatch } from '../src/lib/demo'
import { momentum } from '../src/lib/momentum'
import { posAt } from '../src/lib/track'
import type { Match, Rally, Shot } from '../src/lib/types'
import { ReplayScene } from '../src/components/replay3d'
import { GRADE_META } from '../src/components/ui'
import { BREAK, DROP, FINAL, type VoiceCue } from './music'

export const W = 1080
export const H = 1920
export const DURATION = 33.5

export const CUES: (VoiceCue & { text: string; caption: boolean })[] = []

const LIME = '#d4ff3a'
const SKY = '#38bdf8'
const INK = '#07110d'

// ---------- easing & helpers ----------
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const prog = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3)
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x))
const outBack = (x: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
}

type Ctx = CanvasRenderingContext2D

function text(c: Ctx, s: string, x: number, y: number, o: { size: number; weight?: number; color?: string; align?: CanvasTextAlign; glow?: string; spacing?: number; alpha?: number; font?: string }) {
  c.save()
  c.globalAlpha *= o.alpha ?? 1
  c.font = `${o.weight ?? 800} ${o.size}px ${o.font ?? 'Inter'}, sans-serif`
  c.textAlign = o.align ?? 'center'
  c.textBaseline = 'middle'
  ;(c as Ctx & { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`
  if (o.glow) {
    c.shadowColor = o.glow
    c.shadowBlur = o.size * 0.5
  }
  c.fillStyle = o.color ?? '#fff'
  c.fillText(s, x, y)
  c.restore()
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.roundRect(x, y, w, h, r)
}

function badge(c: Ctx, grade: keyof typeof GRADE_META, x: number, y: number, r: number, alpha = 1) {
  const m = GRADE_META[grade]
  c.save()
  c.globalAlpha *= alpha
  c.shadowColor = m.color
  c.shadowBlur = r * 1.2
  c.fillStyle = m.color
  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  c.fill()
  c.shadowBlur = 0
  text(c, m.symbol, x, y + r * 0.06, { size: r * (m.symbol.length > 1 ? 0.85 : 1.05), weight: 900, color: INK })
  c.restore()
}

function pickleball(c: Ctx, x: number, y: number, r: number, rot = 0) {
  c.save()
  c.translate(x, y)
  c.rotate(rot)
  const g = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r)
  g.addColorStop(0, '#f6ff9e')
  g.addColorStop(1, '#c6ef1f')
  c.shadowColor = LIME
  c.shadowBlur = r * 0.8
  c.fillStyle = g
  c.beginPath()
  c.arc(0, 0, r, 0, Math.PI * 2)
  c.fill()
  c.shadowBlur = 0
  c.fillStyle = 'rgba(7,17,13,.75)'
  const holes = [
    [0, 0],
    [0.45, 0],
    [-0.45, 0],
    [0, 0.45],
    [0, -0.45],
    [0.33, 0.33],
    [-0.33, -0.33],
    [0.33, -0.33],
    [-0.33, 0.33],
  ]
  for (const [hx, hy] of holes) {
    c.beginPath()
    c.arc(hx * r, hy * r, r * 0.09, 0, Math.PI * 2)
    c.fill()
  }
  c.restore()
}

// ---------- shared assets ----------
let match: Match
let rally3d: Rally
let ghostShot: Shot
let rally2d: Rally
let grain: HTMLCanvasElement
let replay: ReplayScene
let mom: ReturnType<typeof momentum>
const particles = (() => {
  const r = rng(42)
  return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H, s: 1 + r() * 3, v: 10 + r() * 40, a: 0.1 + r() * 0.4 }))
})()

export async function setup(stage: HTMLElement) {
  match = simulateMatch(7)
  mom = momentum(match)
  // a long rally with a correctable shot for the 3D scene
  rally3d =
    match.rallies.find((r) => r.shots.length >= 9 && r.shots.some((s) => s.better && s.index >= 3)) ?? match.rallies[0]
  ghostShot = rally3d.shots.find((s) => s.better && s.index >= 3)!
  rally2d = match.rallies.find((r) => r.shots.length >= 8 && r !== rally3d) ?? rally3d
  grain = document.createElement('canvas')
  grain.width = grain.height = 256
  const g = grain.getContext('2d')!
  const img = g.createImageData(256, 256)
  const r = rng(7)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  replay = new ReplayScene(stage, match.players)
  replay.renderer.setPixelRatio(1)
  replay.renderer.setSize(1080, 1080, false)
  replay.camera.aspect = 1
  replay.camera.fov = 44
  replay.camera.updateProjectionMatrix()
  replay.controls.enabled = false
  replay.setRally(rally3d)
}

export function setCues(cues: typeof CUES) {
  CUES.splice(0, CUES.length, ...cues)
}

// ---------- background ----------
function background(c: Ctx, t: number, energy: number) {
  const g = c.createRadialGradient(W / 2, H * 0.35, 50, W / 2, H * 0.45, H * 0.9)
  g.addColorStop(0, '#12301f')
  g.addColorStop(0.5, '#08160f')
  g.addColorStop(1, '#030806')
  c.fillStyle = g
  c.fillRect(0, 0, W, H)
  // perspective floor grid
  c.save()
  c.globalAlpha = 0.18 + energy * 0.12
  c.strokeStyle = LIME
  c.lineWidth = 1.5
  const horizon = H * 0.62
  for (let i = -12; i <= 12; i++) {
    c.beginPath()
    c.moveTo(W / 2 + i * 30, horizon)
    c.lineTo(W / 2 + i * 260, H)
    c.stroke()
  }
  const off = (t * 0.6) % 1
  for (let k = 0; k < 14; k++) {
    const z = (k + off) / 14
    const y = horizon + Math.pow(z, 2.2) * (H - horizon)
    c.globalAlpha = (0.05 + z * 0.25) * (0.6 + energy * 0.6)
    c.beginPath()
    c.moveTo(0, y)
    c.lineTo(W, y)
    c.stroke()
  }
  c.restore()
  // particles
  for (const p of particles) {
    const y = (p.y - t * p.v * (1 + energy)) % H
    c.fillStyle = `rgba(212,255,58,${p.a * (0.5 + energy * 0.5)})`
    c.beginPath()
    c.arc(p.x, y < 0 ? y + H : y, p.s, 0, Math.PI * 2)
    c.fill()
  }
}

function overlays(c: Ctx, t: number) {
  // impact flashes
  for (const [at, strength] of [
    [DROP, 0.9],
    [BREAK + 0.37, 0.6],
    [27.4, 0.5],
    [FINAL, 0.8],
    [16.05, 0.35],
  ] as const) {
    const d = t - at
    if (d >= 0 && d < 0.45) {
      c.fillStyle = `rgba(${at === 16.05 ? '255,60,60' : '235,255,200'},${strength * (1 - d / 0.45)})`
      c.fillRect(0, 0, W, H)
    }
  }
  // vignette
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.65)')
  c.fillStyle = v
  c.fillRect(0, 0, W, H)
  // film grain
  c.save()
  c.globalAlpha = 0.05
  c.globalCompositeOperation = 'overlay'
  const ox = Math.floor((t * 997) % 256)
  const oy = Math.floor((t * 613) % 256)
  for (let x = -ox; x < W; x += 256) for (let y = -oy; y < H; y += 256) c.drawImage(grain, x, y)
  c.restore()
  // fade in/out
  if (t < 0.25) {
    c.fillStyle = `rgba(0,0,0,${1 - t / 0.25})`
    c.fillRect(0, 0, W, H)
  }
  if (t > DURATION - 0.6) {
    c.fillStyle = `rgba(0,0,0,${prog(t, DURATION - 0.6, DURATION)})`
    c.fillRect(0, 0, W, H)
  }
}

function shake(t: number) {
  let s = 0
  for (const [at, amp] of [
    [DROP, 26],
    [BREAK + 0.37, 18],
    [27.4, 14],
    [FINAL, 20],
    [16.05, 22],
  ] as const) {
    const d = t - at
    if (d >= 0 && d < 0.5) s += amp * Math.pow(1 - d / 0.5, 2)
  }
  return { x: Math.sin(t * 91) * s, y: Math.cos(t * 77) * s }
}

/** Kick-synced pulse after the drop (0–1). */
function pulse(t: number) {
  if (t < DROP || (t > BREAK && t < BREAK + 0.5)) return 0
  const beat = 60 / 128
  const ph = ((t - DROP) % beat) / beat
  return Math.pow(1 - ph, 4)
}

function sectionLabel(c: Ctx, n: string, label: string, t: number, a: number, b: number) {
  const pin = outExpo(prog(t, a, a + 0.4))
  const pout = prog(t, b - 0.25, b)
  const alpha = pin * (1 - pout)
  if (alpha <= 0) return
  c.save()
  c.globalAlpha = alpha
  const x = W / 2
  const y = 230 - (1 - pin) * 40
  c.font = '800 34px Inter, sans-serif'
  ;(c as Ctx & { letterSpacing: string }).letterSpacing = '6px'
  const w = c.measureText(label).width + 130
  roundRect(c, x - w / 2, y - 36, w, 72, 36)
  c.fillStyle = 'rgba(212,255,58,.12)'
  c.fill()
  c.strokeStyle = 'rgba(212,255,58,.5)'
  c.lineWidth = 2
  c.stroke()
  c.fillStyle = LIME
  c.beginPath()
  c.arc(x - w / 2 + 40, y, 18, 0, Math.PI * 2)
  c.fill()
  text(c, n, x - w / 2 + 40, y + 1, { size: 22, weight: 900, color: INK })
  text(c, label, x + 22, y + 2, { size: 34, weight: 800, color: LIME, spacing: 6 })
  c.restore()
}

// ---------- captions (word-by-word, for sound-off viewing) ----------
function captions(c: Ctx, t: number) {
  const cue = CUES.find((q) => q.caption && t >= q.at - 0.05 && t <= q.at + q.dur + 0.25)
  if (!cue) return
  const words = cue.text.split(' ')
  const totalChars = words.reduce((n, w) => n + w.length + 1, 0)
  let acc = 0
  const times = words.map((w) => {
    const start = cue.at + (acc / totalChars) * cue.dur
    acc += w.length + 1
    return start
  })
  c.save()
  c.font = '800 52px Inter, sans-serif'
  const lines: string[][] = [[]]
  let lineW = 0
  for (const w of words) {
    const ww = c.measureText(w + ' ').width
    if (lineW + ww > 900 && lines[lines.length - 1].length) {
      lines.push([])
      lineW = 0
    }
    lines[lines.length - 1].push(w)
    lineW += ww
  }
  const appear = outCubic(prog(t, cue.at - 0.05, cue.at + 0.15))
  let wi = 0
  lines.forEach((ln, li) => {
    const lw = c.measureText(ln.join(' ')).width
    let x = W / 2 - lw / 2
    const y = 1655 + li * 70 + (1 - appear) * 20
    for (const w of ln) {
      const active = t >= times[wi] && (wi === words.length - 1 || t < times[wi + 1])
      const said = t >= times[wi]
      const ww = c.measureText(w).width
      c.globalAlpha = appear * (said ? 1 : 0.45)
      if (active) {
        c.fillStyle = LIME
        roundRect(c, x - 10, y - 38, ww + 20, 74, 14)
        c.fill()
      }
      c.fillStyle = active ? INK : '#fff'
      c.textBaseline = 'middle'
      c.textAlign = 'left'
      c.shadowColor = 'rgba(0,0,0,.6)'
      c.shadowBlur = active ? 0 : 12
      c.fillText(w, x, y + 2)
      x += ww + c.measureText(' ').width
      wi++
    }
  })
  c.restore()
}

// ---------- scenes ----------
function sceneHook(c: Ctx, t: number) {
  // net across the frame, ball smashes into it
  const netY = 1020
  c.save()
  c.fillStyle = 'rgba(255,255,255,.06)'
  for (let x = 0; x < W; x += 26) c.fillRect(x, netY - 150, 2, 150)
  for (let y = netY - 150; y < netY; y += 26) c.fillRect(0, y, W, 2)
  c.fillStyle = '#fff'
  c.fillRect(0, netY - 160, W, 14)
  c.restore()
  const p = prog(t, 0.15, 0.95)
  if (t < 0.95) {
    const bx = lerp(W * 0.25, W * 0.55, p)
    const by = lerp(1750, netY - 120, outCubic(p)) - Math.sin(p * Math.PI) * 120
    for (let k = 1; k < 8; k++) {
      const q = Math.max(0, p - k * 0.03)
      c.globalAlpha = 0.12 * (8 - k)
      pickleball(c, lerp(W * 0.25, W * 0.55, q), lerp(1750, netY - 120, outCubic(q)) - Math.sin(q * Math.PI) * 120, 34 + q * -6)
    }
    c.globalAlpha = 1
    pickleball(c, bx, by, 34 - p * 6, t * 6)
  } else {
    const d = t - 0.95
    const by = netY - 120 + Math.min(1, d * 1.8) * 230 + Math.abs(Math.sin(d * 7)) * 60 * Math.exp(-d * 3)
    pickleball(c, W * 0.55 + d * 30, Math.min(by, 1260), 28, 6 + d * 2)
    if (d < 0.5) {
      c.strokeStyle = `rgba(255,80,80,${1 - d * 2})`
      c.lineWidth = 6
      c.beginPath()
      c.arc(W * 0.55, netY - 120, 30 + d * 300, 0, Math.PI * 2)
      c.stroke()
    }
  }
  // kinetic text
  const words = ['YOU', 'LOST', 'THAT', 'POINT.']
  const wordT = [0.3, 0.55, 0.78, 1.0]
  const out1 = prog(t, 1.6, 1.8)
  words.forEach((w, i) => {
    const a = outBack(prog(t, wordT[i], wordT[i] + 0.22))
    if (a <= 0) return
    const y = 420 + i * 125
    c.save()
    c.globalAlpha = Math.min(1, a) * (1 - out1)
    c.translate(W / 2, y)
    c.scale(1.6 - 0.6 * Math.min(a, 1.05), 1.6 - 0.6 * Math.min(a, 1.05))
    text(c, w, 0, 0, { size: 130, weight: 900, color: i === 3 ? '#ff5a5a' : '#fff', glow: i === 3 ? '#ff3b3b' : undefined })
    c.restore()
  })
  // "But do you know WHY?"
  const a2 = outExpo(prog(t, 1.65, 1.95))
  if (a2 > 0) {
    text(c, 'BUT DO YOU KNOW', W / 2, 560, { size: 82, weight: 800, alpha: a2, spacing: 4 })
    const why = outBack(prog(t, 2.7, 2.95)) // on the spoken "why"
    if (why > 0) {
      const jitter = t > 2.5 && t < 3.6 ? Math.sin(t * 60) * 6 : 0
      c.save()
      c.translate(W / 2, 760)
      const s = 0.4 + why * 0.6 + prog(t, 2.7, 3.75) * 0.25
      c.scale(s, s)
      c.globalCompositeOperation = 'lighter'
      text(c, 'WHY?', -jitter, 0, { size: 300, weight: 900, color: 'rgba(255,0,80,.7)' })
      text(c, 'WHY?', jitter, 0, { size: 300, weight: 900, color: 'rgba(0,200,255,.7)' })
      c.globalCompositeOperation = 'source-over'
      text(c, 'WHY?', 0, 0, { size: 300, weight: 900, color: LIME, glow: LIME })
      c.restore()
    }
  }
}

function sceneLogo(c: Ctx, t: number) {
  const lt = t - DROP
  // light rays
  c.save()
  c.translate(W / 2, 760)
  c.rotate(t * 0.15)
  for (let i = 0; i < 16; i++) {
    c.rotate((Math.PI * 2) / 16)
    c.fillStyle = `rgba(212,255,58,${0.035 + pulse(t) * 0.03})`
    c.beginPath()
    c.moveTo(0, 0)
    c.lineTo(-90, -1400)
    c.lineTo(90, -1400)
    c.fill()
  }
  c.restore()
  // ball drops in and slams
  const fall = prog(t, DROP - 0.35, DROP)
  const by = lt < 0 ? lerp(-200, 760, fall * fall) : 760 - Math.abs(Math.sin(lt * 9)) * 90 * Math.exp(-lt * 4)
  const r = 150 * (lt < 0 ? 1 : 1 + 0.08 * Math.exp(-lt * 6))
  pickleball(c, W / 2, by, r, lt * 0.8)
  // shockwaves
  for (let k = 0; k < 3; k++) {
    const d = lt - k * 0.12
    if (d > 0 && d < 1) {
      c.strokeStyle = `rgba(212,255,58,${(1 - d) * 0.8})`
      c.lineWidth = 10 * (1 - d)
      c.beginPath()
      c.arc(W / 2, 760, 150 + outCubic(d) * 600, 0, Math.PI * 2)
      c.stroke()
    }
  }
  // wordmark
  const letters = 'KitchenIQ'.split('')
  c.font = '900 150px Inter, sans-serif'
  const total = c.measureText('KitchenIQ').width
  let x = W / 2 - total / 2
  letters.forEach((ch, i) => {
    const a = outBack(prog(t, DROP + 0.12 + i * 0.045, DROP + 0.45 + i * 0.045))
    const w = c.measureText(ch).width
    if (a > 0) {
      c.save()
      c.globalAlpha = Math.min(1, a)
      c.translate(x + w / 2, 1080 + (1 - a) * 120)
      text(c, ch, 0, 0, { size: 150, weight: 900, color: i >= 7 ? LIME : '#fff', glow: i >= 7 ? LIME : undefined })
      c.restore()
    }
    x += w
  })
  const tag = outCubic(prog(t, 4.75, 5.3))
  text(c, 'THE AI COACH THAT WATCHES', W / 2, 1230, { size: 42, weight: 700, color: '#c9dbd0', alpha: tag, spacing: 3 + (1 - tag) * 20 })
  text(c, 'EVERY SHOT YOU PLAY', W / 2, 1290, { size: 42, weight: 800, color: LIME, alpha: tag, spacing: 3 + (1 - tag) * 20 })
}

function sceneTracking(c: Ctx, t: number) {
  const a = 7.75
  const appear = outExpo(prog(t, a, a + 0.5))
  const corners = [
    { x: 395, y: 640 },
    { x: 685, y: 640 },
    { x: 1010, y: 1450 },
    { x: 70, y: 1450 },
  ]
  const Hm = homographies(corners.map((p) => ({ x: p.x / W, y: p.y / H }))).toImage
  const P = (x: number, y: number) => {
    const q = applyH(Hm, { x, y })
    return { x: q.x * W, y: q.y * H }
  }
  c.save()
  c.globalAlpha = appear
  c.translate(0, (1 - appear) * 200)
  // court
  c.fillStyle = '#1f4aa8'
  c.beginPath()
  corners.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
  c.fill()
  const kq = [P(0, 15), P(20, 15), P(20, 29), P(0, 29)]
  c.fillStyle = '#2a63c9'
  c.beginPath()
  kq.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
  c.fill()
  // lines draw on
  const lp = prog(t, a + 0.2, a + 1.1)
  c.strokeStyle = '#fff'
  c.lineWidth = 5
  c.shadowColor = '#fff'
  c.shadowBlur = 8
  for (const [p0, p1] of courtLines()) {
    const A = P(p0.x, p0.y)
    const B = P(p1.x, p1.y)
    c.beginPath()
    c.moveTo(A.x, A.y)
    c.lineTo(lerp(A.x, B.x, lp), lerp(A.y, B.y, lp))
    c.stroke()
  }
  c.shadowBlur = 0
  const n0 = P(-1, NET_Y)
  const n1 = P(21, NET_Y)
  c.strokeStyle = 'rgba(255,255,255,.9)'
  c.lineWidth = 9
  c.beginPath()
  c.moveTo(n0.x, n0.y - 40)
  c.lineTo(n1.x, n1.y - 40)
  c.stroke()
  // calibration dots
  corners.forEach((p, i) => {
    const d = outBack(prog(t, a + 0.1 + i * 0.1, a + 0.4 + i * 0.1))
    if (d <= 0) return
    c.fillStyle = LIME
    c.beginPath()
    c.arc(p.x, p.y, 18 * d, 0, Math.PI * 2)
    c.fill()
    text(c, String(i + 1), p.x, p.y + 1, { size: 20 * d, weight: 900, color: INK })
  })

  // players + ball from a real simulated rally
  const r = rally2d
  const rt = r.shots[0].t - 0.4 + Math.max(0, t - (a + 0.9)) * 1.05
  const segs = buildSegments(r)
  for (const pl of match.players) {
    const cp = posAt(r.track, pl.id, rt)
    if (!cp) continue
    const f = P(cp.x, cp.y)
    const sc = 0.55 + (f.y - 640) / 810 * 0.75
    const hgt = 175 * sc
    const hitting = r.shots.some((s) => s.hitter === pl.id && Math.abs(s.t - rt) < 0.3)
    c.strokeStyle = pl.color
    c.shadowColor = pl.color
    c.shadowBlur = hitting ? 30 : 14
    c.lineWidth = 7 * sc
    c.lineCap = 'round'
    const hip = { x: f.x, y: f.y - hgt * 0.5 }
    const sh = { x: f.x, y: f.y - hgt * 0.82 }
    const swing = hitting ? Math.sin((rt % 0.6) * 10) : 0
    const seg = (x1: number, y1: number, x2: number, y2: number) => {
      c.beginPath()
      c.moveTo(x1, y1)
      c.lineTo(x2, y2)
      c.stroke()
    }
    seg(f.x - 18 * sc, f.y, hip.x, hip.y)
    seg(f.x + 18 * sc, f.y, hip.x, hip.y)
    seg(hip.x, hip.y, sh.x, sh.y)
    seg(sh.x, sh.y, sh.x - 30 * sc, sh.y + 55 * sc)
    seg(sh.x, sh.y, sh.x + 40 * sc + swing * 20 * sc, sh.y + 20 * sc - swing * 40 * sc)
    c.shadowBlur = 0
    c.fillStyle = pl.color
    c.beginPath()
    c.arc(sh.x, sh.y - 26 * sc, 17 * sc, 0, Math.PI * 2)
    c.fill()
    // name tag
    c.font = `800 ${26 * sc}px Inter`
    const tw = c.measureText(pl.name).width + 26 * sc
    roundRect(c, sh.x - tw / 2, sh.y - 92 * sc, tw, 38 * sc, 19 * sc)
    c.fill()
    text(c, pl.name, sh.x, sh.y - 72 * sc, { size: 26 * sc, weight: 800, color: INK })
  }
  const b = ballAt(segs, rt)
  if (b) {
    const f = P(b.x, b.y)
    const sc = 0.55 + (f.y - 640) / 810 * 0.75
    c.fillStyle = 'rgba(0,0,0,.35)'
    c.beginPath()
    c.ellipse(f.x, f.y, 14 * sc, 6 * sc, 0, 0, Math.PI * 2)
    c.fill()
    for (let k = 6; k >= 0; k--) {
      const bk = ballAt(segs, rt - k * 0.03)
      if (!bk) continue
      const fk = P(bk.x, bk.y)
      c.globalAlpha = appear * (k ? 0.12 * (7 - k) : 1)
      pickleball(c, fk.x, fk.y - bk.h * 42 * sc, 13 * sc)
    }
    c.globalAlpha = appear
  }
  c.restore()

  // viewfinder brackets + REC
  const vf = outCubic(prog(t, a + 0.1, a + 0.6))
  c.save()
  c.globalAlpha = vf
  c.strokeStyle = '#fff'
  c.lineWidth = 6
  const m = 40 + (1 - vf) * 60
  const [x0, y0, x1, y1] = [m, 360 + m, W - m, 1560 - m]
  for (const [x, y, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ]) {
    c.beginPath()
    c.moveTo(x, y + dy * 70)
    c.lineTo(x, y)
    c.lineTo(x + dx * 70, y)
    c.stroke()
  }
  if (Math.floor(t * 2) % 2 === 0) {
    c.fillStyle = '#ef4444'
    c.beginPath()
    c.arc(x0 + 50, y0 + 50, 12, 0, Math.PI * 2)
    c.fill()
  }
  text(c, 'REC', x0 + 100, y0 + 52, { size: 30, weight: 800, align: 'left' })
  // scan line
  const sy = y0 + ((t * 0.7) % 1) * (y1 - y0)
  const sg = c.createLinearGradient(0, sy - 60, 0, sy)
  sg.addColorStop(0, 'rgba(212,255,58,0)')
  sg.addColorStop(1, 'rgba(212,255,58,.25)')
  c.fillStyle = sg
  c.fillRect(x0, sy - 60, x1 - x0, 60)
  c.restore()

  // HUD chips + scoreboard
  const chips = ['4 PLAYERS TRACKED', 'PADDLE POPS: ON', 'COURT MAPPED']
  chips.forEach((s, i) => {
    const d = outBack(prog(t, a + 1.2 + i * 0.35, a + 1.5 + i * 0.35))
    if (d <= 0) return
    c.save()
    c.globalAlpha = Math.min(1, d)
    c.font = '800 28px Inter'
    const w = c.measureText(s).width + 70
    const x = 70
    const y = 470 + i * 70
    roundRect(c, x + (1 - d) * -80, y, w, 52, 26)
    c.fillStyle = 'rgba(7,17,13,.75)'
    c.fill()
    c.strokeStyle = 'rgba(212,255,58,.5)'
    c.lineWidth = 2
    c.stroke()
    c.fillStyle = LIME
    c.beginPath()
    c.arc(x + 28 + (1 - d) * -80, y + 26, 7, 0, Math.PI * 2)
    c.fill()
    text(c, s, x + 46 + (1 - d) * -80, y + 27, { size: 28, weight: 800, align: 'left' })
    c.restore()
  })
  const sbA = outBack(prog(t, a + 1.6, a + 1.95))
  if (sbA > 0) {
    c.save()
    c.globalAlpha = Math.min(1, sbA)
    c.translate(W - 70 - 260, 470)
    roundRect(c, 0, 0, 260, 150, 24)
    c.fillStyle = 'rgba(7,17,13,.85)'
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,.15)'
    c.stroke()
    text(c, 'SCORE', 130, 34, { size: 22, weight: 800, color: '#8aa597', spacing: 4 })
    const flip = prog(t, 11.6, 11.9)
    const sc = flip < 0.5 ? '4-2-1' : '5-2-1'
    c.save()
    c.translate(130, 95)
    c.scale(1, Math.abs(Math.cos(flip * Math.PI)))
    text(c, sc, 0, 0, { size: 64, weight: 900, color: flip >= 0.5 ? LIME : '#fff', font: 'JetBrains Mono' })
    c.restore()
    c.restore()
  }
}

function sceneGrades(c: Ctx, t: number) {
  const a = 12.95
  const order = ['brilliant', 'great', 'excellent', 'good', 'inaccuracy', 'mistake', 'missed', 'blunder'] as const
  const listOut = prog(t, 15.0, 15.25)
  order.forEach((g, i) => {
    const d = outBack(prog(t, 13.35 + i * 0.16, 13.65 + i * 0.16))
    if (d <= 0) return
    const y = 470 + i * 128
    c.save()
    c.globalAlpha = Math.min(1, d) * (1 - listOut)
    c.translate((1 - d) * 300 + listOut * -200, 0)
    roundRect(c, 150, y - 52, 780, 104, 52)
    c.fillStyle = 'rgba(16,32,25,.85)'
    c.fill()
    c.strokeStyle = GRADE_META[g].color + '66'
    c.lineWidth = 3
    c.stroke()
    badge(c, g, 210, y, 38)
    text(c, GRADE_META[g].label, 275, y + 2, { size: 46, weight: 800, align: 'left', color: GRADE_META[g].color })
    c.restore()
  })
  // BRILLIANT hero
  const br = prog(t, 15.2, 15.5)
  const bo = prog(t, 15.95, 16.1)
  if (br > 0 && bo < 1) {
    const s = outBack(br)
    c.save()
    c.globalAlpha = 1 - bo
    c.translate(W / 2, 880)
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * Math.PI * 2
      const d = outCubic(prog(t, 15.25, 15.9)) * 420
      c.fillStyle = `rgba(34,211,238,${1 - prog(t, 15.25, 15.95)})`
      c.beginPath()
      c.arc(Math.cos(ang) * d, Math.sin(ang) * d, 9, 0, Math.PI * 2)
      c.fill()
    }
    c.scale(s, s)
    badge(c, 'brilliant', 0, 0, 170)
    c.restore()
    text(c, 'BRILLIANT', W / 2, 1180, { size: 130, weight: 900, color: GRADE_META.brilliant.color, glow: GRADE_META.brilliant.color, alpha: outCubic(br) * (1 - bo) })
  }
  const bl = prog(t, 16.05, 16.3)
  if (bl > 0) {
    const s = outBack(bl)
    const jit = Math.sin(t * 80) * 10 * (1 - prog(t, 16.05, 16.6))
    c.save()
    c.translate(W / 2 + jit, 880)
    c.scale(s, s)
    badge(c, 'blunder', 0, 0, 170)
    c.restore()
    text(c, 'BLUNDER', W / 2 - jit, 1180, { size: 130, weight: 900, color: GRADE_META.blunder.color, glow: GRADE_META.blunder.color, alpha: outCubic(bl) })
  }
}

function sceneMomentum(c: Ctx, t: number) {
  const a = 16.75
  const appear = outExpo(prog(t, a, a + 0.4))
  const x0 = 70
  const x1 = W - 70
  const y0 = 560
  const h = 640
  c.save()
  c.globalAlpha = appear
  c.translate(0, (1 - appear) * 120)
  roundRect(c, x0 - 20, y0 - 90, x1 - x0 + 40, h + 180, 40)
  c.fillStyle = 'rgba(16,32,25,.9)'
  c.fill()
  c.strokeStyle = 'rgba(255,255,255,.1)'
  c.lineWidth = 2
  c.stroke()
  text(c, 'WIN PROBABILITY', x0 + 20, y0 - 40, { size: 30, weight: 800, color: '#8aa597', align: 'left', spacing: 4 })
  const n = mom.length - 1
  const X = (i: number) => x0 + (i / n) * (x1 - x0)
  const Y = (wp: number) => y0 + 30 + (1 - wp) * (h - 60)
  const reveal = inOut(prog(t, a + 0.15, a + 1.6))
  const upto = Math.floor(reveal * n)
  c.strokeStyle = 'rgba(255,255,255,.3)'
  c.setLineDash([10, 10])
  c.beginPath()
  c.moveTo(x0, Y(0.5))
  c.lineTo(x1, Y(0.5))
  c.stroke()
  c.setLineDash([])
  const grad = c.createLinearGradient(0, y0, 0, y0 + h)
  grad.addColorStop(0, 'rgba(212,255,58,.55)')
  grad.addColorStop(0.5, 'rgba(212,255,58,.05)')
  grad.addColorStop(0.5, 'rgba(56,189,248,.05)')
  grad.addColorStop(1, 'rgba(56,189,248,.55)')
  c.beginPath()
  c.moveTo(X(0), Y(0.5))
  for (let i = 0; i <= upto; i++) c.lineTo(X(i), Y(mom[i].wp))
  c.lineTo(X(upto), Y(0.5))
  c.fillStyle = grad
  c.fill()
  c.beginPath()
  for (let i = 0; i <= upto; i++) (i ? c.lineTo : c.moveTo).call(c, X(i), Y(mom[i].wp))
  c.strokeStyle = '#fff'
  c.lineWidth = 5
  c.shadowColor = '#fff'
  c.shadowBlur = 10
  c.stroke()
  c.shadowBlur = 0
  for (let i = 0; i <= upto; i++) {
    const g = mom[i].grade
    if (g === 'brilliant' || g === 'blunder') badge(c, g, X(i), Y(mom[i].wp), 15, 0.95)
  }
  // biggest swing against the near team
  let worst = 1
  let wi = 0
  for (let i = 1; i < mom.length; i++) {
    const d = mom[i].wp - mom[i - 1].wp
    if (d < worst) {
      worst = d
      wi = i
    }
  }
  const z = outBack(prog(t, a + 1.6, a + 1.95))
  if (z > 0 && wi <= upto) {
    const px = X(wi)
    const py = Y(mom[wi].wp)
    const ring = (t * 1.5) % 1
    c.strokeStyle = `rgba(255,90,90,${1 - ring})`
    c.lineWidth = 6
    c.beginPath()
    c.arc(px, py, 20 + ring * 70, 0, Math.PI * 2)
    c.stroke()
    c.save()
    c.globalAlpha = Math.min(1, z)
    const bx = Math.min(Math.max(px, 300), W - 300)
    roundRect(c, bx - 230, y0 + h - 10, 460, 120, 30)
    c.fillStyle = '#ef4444'
    c.fill()
    text(c, 'THE MATCH TURNED HERE', bx, y0 + h + 35, { size: 40, weight: 900 })
    text(c, `Rally ${mom[wi].rally + 1}${mom[wi].grade ? ' · ' + GRADE_META[mom[wi].grade!].label : ''}`, bx, y0 + h + 80, { size: 26, weight: 600, color: '#ffe4e4' })
    c.restore()
  }
  c.restore()
}

function scene3D(c: Ctx, t: number) {
  const a = 19.25
  const appear = outExpo(prog(t, a, a + 0.45))
  const ghostAt = 21.7
  const seq = rally3d.shots
  const startT = Math.max(seq[0].t - 0.4, ghostShot.t - 3)
  const rt = t < ghostAt ? startT + (t - a) * ((ghostShot.t + 0.05 - startT) / (ghostAt - a)) : ghostShot.t + 0.05
  if (t >= ghostAt && !(replay as unknown as { _ghost?: boolean })._ghost) {
    replay.showGhost(ghostShot, ghostShot.better!)
    ;(replay as unknown as { _ghost?: boolean })._ghost = true
  }
  if (t < ghostAt && (replay as unknown as { _ghost?: boolean })._ghost) {
    replay.clearGhost()
    ;(replay as unknown as { _ghost?: boolean })._ghost = false
  }
  // cinematic orbit, swinging to the side for the ghost reveal
  const orbit = lerp(-0.55, 0.35, inOut(prog(t, a, ghostAt)))
  const side = inOut(prog(t, ghostAt, ghostAt + 0.8))
  const ang = lerp(orbit, -1.35, side)
  const rad = lerp(48, 40, side)
  const hgt = lerp(24, 15, side)
  replay.camera.position.set(Math.sin(ang) * rad, hgt, Math.cos(ang) * rad)
  replay.controls.target.set(0, 1.5, 0)
  replay.camera.lookAt(0, 1.5, 0)
  replay.step(rt)
  replay.setGhostPhase((((t - ghostAt) % 1.3) + 1.3) % 1.3 / 1.3)
  replay.renderer.render(replay.scene, replay.camera)

  c.save()
  c.globalAlpha = appear
  const size = 1000
  const x = (W - size) / 2
  const y = 420 + (1 - appear) * 120
  roundRect(c, x, y, size, size, 48)
  c.save()
  c.clip()
  c.drawImage(replay.canvas, x, y, size, size)
  c.restore()
  c.strokeStyle = 'rgba(212,255,58,.4)'
  c.lineWidth = 3
  roundRect(c, x, y, size, size, 48)
  c.stroke()
  // legend for the ghost
  const lg = outBack(prog(t, ghostAt + 0.3, ghostAt + 0.6))
  if (lg > 0) {
    c.globalAlpha = Math.min(1, lg) * appear
    roundRect(c, x + 30, y + size - 150, size - 60, 120, 30)
    c.fillStyle = 'rgba(8,40,48,.88)'
    c.fill()
    c.strokeStyle = 'rgba(103,232,249,.6)'
    c.stroke()
    c.fillStyle = '#22d3ee'
    c.fillRect(x + 70, y + size - 105, 60, 8)
    text(c, 'BETTER SHOT', x + 150, y + size - 100, { size: 32, weight: 900, color: '#a5f3fc', align: 'left' })
    c.strokeStyle = '#ef4444'
    c.lineWidth = 6
    c.setLineDash([12, 8])
    c.beginPath()
    c.moveTo(x + 560, y + size - 101)
    c.lineTo(x + 620, y + size - 101)
    c.stroke()
    c.setLineDash([])
    text(c, 'WHAT HAPPENED', x + 640, y + size - 100, { size: 32, weight: 900, color: '#fecaca', align: 'left' })
    text(c, ghostShot.better!.tip.split('.')[0] + '.', x + size / 2, y + size - 58, { size: 26, weight: 600, color: '#cffafe' })
  }
  c.restore()
}

function sceneCoach(c: Ctx, t: number) {
  const a = 23.15
  const me = match.players[0]
  const st = match.stats[me.id]
  const arrival = st.kitchenChances ? Math.round((st.kitchenArrivals / st.kitchenChances) * 100) : 0
  const ap = outExpo(prog(t, a, a + 0.4))
  c.save()
  c.globalAlpha = ap
  // avatar with talking rings
  const ax = W / 2
  const ay = 560
  for (let k = 0; k < 3; k++) {
    const ph = ((t * 1.2 + k / 3) % 1)
    c.strokeStyle = `rgba(34,211,238,${(1 - ph) * 0.7})`
    c.lineWidth = 4
    c.beginPath()
    c.arc(ax, ay, 110 + ph * 120, 0, Math.PI * 2)
    c.stroke()
  }
  const g = c.createRadialGradient(ax - 30, ay - 30, 10, ax, ay, 110)
  g.addColorStop(0, '#22d3ee88')
  g.addColorStop(1, '#0c1913')
  c.fillStyle = g
  c.beginPath()
  c.arc(ax, ay, 110, 0, Math.PI * 2)
  c.fill()
  c.strokeStyle = '#22d3ee'
  c.lineWidth = 5
  c.stroke()
  text(c, '🎯', ax, ay + 6, { size: 110, weight: 400 })
  text(c, 'COACH MAYA', ax, ay + 160, { size: 32, weight: 800, color: '#8aa597', spacing: 5 })
  // insight card
  const ic = outBack(prog(t, a + 0.35, a + 0.7))
  if (ic > 0) {
    c.save()
    c.globalAlpha = Math.min(1, ic) * ap
    c.translate(0, (1 - ic) * 80)
    roundRect(c, 80, 820, W - 160, 300, 40)
    c.fillStyle = 'rgba(16,32,25,.95)'
    c.fill()
    c.fillStyle = '#fb923c'
    c.fillRect(80, 840, 10, 260)
    text(c, 'BIGGEST LEAK', 130, 880, { size: 28, weight: 800, color: '#fdba74', align: 'left', spacing: 4 })
    const full = 'Stuck in no-man’s land'
    const n = Math.floor(prog(t, a + 0.5, a + 1.3) * full.length)
    text(c, full.slice(0, n), 130, 950, { size: 58, weight: 900, align: 'left' })
    // ring
    const rv = outCubic(prog(t, a + 0.7, a + 1.6)) * arrival
    c.lineWidth = 16
    c.strokeStyle = 'rgba(255,255,255,.1)'
    c.beginPath()
    c.arc(W - 220, 1040, 56, 0, Math.PI * 2)
    c.stroke()
    c.strokeStyle = '#fb923c'
    c.lineCap = 'round'
    c.beginPath()
    c.arc(W - 220, 1040, 56, -Math.PI / 2, -Math.PI / 2 + (rv / 100) * Math.PI * 2)
    c.stroke()
    text(c, `${Math.round(rv)}%`, W - 220, 1042, { size: 34, weight: 900 })
    text(c, 'kitchen arrival', 130, 1040, { size: 34, weight: 600, color: '#c9dbd0', align: 'left' })
    c.restore()
  }
  // drill card
  const dc = outBack(prog(t, 24.3, 24.65))
  if (dc > 0) {
    c.save()
    c.globalAlpha = Math.min(1, dc) * ap
    c.translate((1 - dc) * 400, 0)
    roundRect(c, 80, 1170, W - 160, 200, 40)
    c.fillStyle = LIME
    c.fill()
    text(c, 'YOUR FIX THIS WEEK', 130, 1225, { size: 28, weight: 800, color: '#2f3d0b', align: 'left', spacing: 4 })
    text(c, 'Return & Run drill', 130, 1290, { size: 58, weight: 900, color: INK, align: 'left' })
    text(c, '10 min', W - 130, 1290, { size: 40, weight: 800, color: INK, align: 'right' })
    c.restore()
  }
  c.restore()
}

function sceneSlam(c: Ctx, t: number) {
  if (t < BREAK + 0.3) return
  const s1 = outBack(prog(t, 26.4, 26.62))
  const s2 = outBack(prog(t, 27.4, 27.62))
  const pz = 1 + pulse(t) * 0.04
  c.save()
  c.translate(W / 2, 760)
  c.scale(pz * (2 - Math.min(1, s1)), pz * (2 - Math.min(1, s1)))
  text(c, 'STOP', 0, -90, { size: 210, weight: 900, alpha: Math.min(1, s1) })
  text(c, 'GUESSING.', 0, 110, { size: 170, weight: 900, alpha: Math.min(1, s1) })
  c.restore()
  if (s2 > 0) {
    c.save()
    c.translate(W / 2, 1180)
    const sc = pz * (2 - Math.min(1, s2))
    c.scale(sc, sc)
    text(c, 'START', 0, -90, { size: 210, weight: 900, color: LIME, glow: LIME, alpha: Math.min(1, s2) })
    text(c, 'WINNING.', 0, 110, { size: 180, weight: 900, color: LIME, glow: LIME, alpha: Math.min(1, s2) })
    c.restore()
  }
}

function phoneMock(c: Ctx, x: number, y: number, w: number, h: number, t: number) {
  c.save()
  roundRect(c, x, y, w, h, 70)
  c.fillStyle = '#05080a'
  c.fill()
  c.strokeStyle = '#2b3a33'
  c.lineWidth = 8
  c.stroke()
  roundRect(c, x + 18, y + 18, w - 36, h - 36, 54)
  c.save()
  c.clip()
  const sx = x + 18
  const sy = y + 18
  const sw = w - 36
  const g = c.createLinearGradient(0, sy, 0, sy + h)
  g.addColorStop(0, '#13301f')
  g.addColorStop(1, '#07110d')
  c.fillStyle = g
  c.fillRect(sx, sy, sw, h)
  text(c, 'GAME REVIEW', sx + sw / 2, sy + 90, { size: 24, weight: 800, color: LIME, spacing: 4 })
  text(c, '8 – 11', sx + sw / 2, sy + 170, { size: 84, weight: 900 })
  const accs = match.players.map((p) => ({ v: match.stats[p.id].accuracy, c: p.color, n: p.name }))
  accs.forEach((p, i) => {
    const cx = sx + sw * (0.14 + i * 0.24)
    const cy = sy + 300
    const v = outCubic(prog(t, FINAL + 0.3 + i * 0.1, FINAL + 1.3 + i * 0.1)) * p.v
    c.lineWidth = 9
    c.strokeStyle = 'rgba(255,255,255,.1)'
    c.beginPath()
    c.arc(cx, cy, 38, 0, Math.PI * 2)
    c.stroke()
    c.strokeStyle = p.c
    c.lineCap = 'round'
    c.beginPath()
    c.arc(cx, cy, 38, -Math.PI / 2, -Math.PI / 2 + (v / 100) * Math.PI * 2)
    c.stroke()
    text(c, String(Math.round(v)), cx, cy + 2, { size: 26, weight: 900 })
    text(c, p.n, cx, cy + 62, { size: 18, weight: 700, color: '#c9dbd0' })
  })
  // mini graph
  const gx = sx + 30
  const gw = sw - 60
  const gy = sy + 420
  const gh = 170
  c.beginPath()
  const n = mom.length - 1
  const rev = prog(t, FINAL + 0.4, FINAL + 1.8)
  for (let i = 0; i <= Math.floor(n * rev); i++) (i ? c.lineTo : c.moveTo).call(c, gx + (i / n) * gw, gy + (1 - mom[i].wp) * gh)
  c.strokeStyle = '#fff'
  c.lineWidth = 3
  c.stroke()
  const rows: (keyof typeof GRADE_META)[] = ['brilliant', 'great', 'mistake', 'blunder']
  rows.forEach((gname, i) => {
    const ry = gy + gh + 60 + i * 64
    const d = outBack(prog(t, FINAL + 0.9 + i * 0.12, FINAL + 1.2 + i * 0.12))
    if (d <= 0) return
    c.globalAlpha = Math.min(1, d)
    badge(c, gname, gx + 22, ry, 20)
    text(c, GRADE_META[gname].label, gx + 60, ry + 1, { size: 26, weight: 800, color: GRADE_META[gname].color, align: 'left' })
    text(c, String(match.stats.p1.grades[gname]), gx + gw - 10, ry + 1, { size: 26, weight: 900, align: 'right' })
    c.globalAlpha = 1
  })
  c.restore()
  // notch
  roundRect(c, x + w / 2 - 70, y + 30, 140, 34, 17)
  c.fillStyle = '#000'
  c.fill()
  c.restore()
}

function sceneCTA(c: Ctx, t: number) {
  const ph = outExpo(prog(t, FINAL, FINAL + 0.7))
  const pw = 560
  const phh = 1000
  c.save()
  c.translate(W / 2, 1130 + (1 - ph) * 900)
  c.rotate((1 - ph) * 0.2 - 0.04 + Math.sin(t * 1.2) * 0.012)
  c.shadowColor = 'rgba(212,255,58,.35)'
  c.shadowBlur = 90
  phoneMock(c, -pw / 2, -phh / 2, pw, phh, t)
  c.restore()
  // logo
  const la = outBack(prog(t, FINAL + 0.15, FINAL + 0.5))
  if (la > 0) {
    c.save()
    c.translate(W / 2, 330)
    c.scale(Math.min(1.1, la), Math.min(1.1, la))
    pickleball(c, -345, 0, 52, t)
    text(c, 'Kitchen', -40 + 25, 4, { size: 110, weight: 900 })
    text(c, 'IQ', 245 + 25, 4, { size: 110, weight: 900, color: LIME, glow: LIME })
    c.restore()
  }
  const cta = outBack(prog(t, 29.8, 30.15)) // lands on "coming soon"
  if (cta > 0) {
    c.save()
    c.globalAlpha = Math.min(1, cta)
    const pz = 1 + pulse(t) * 0.05
    c.translate(W / 2, 1720)
    c.scale(pz * Math.min(1, cta), pz * Math.min(1, cta))
    roundRect(c, -290, -66, 580, 132, 66)
    c.fillStyle = LIME
    c.shadowColor = LIME
    c.shadowBlur = 50
    c.fill()
    c.shadowBlur = 0
    text(c, 'COMING SOON', 0, 3, { size: 60, weight: 900, color: INK, spacing: 6 })
    c.restore()
  }
  text(c, 'Follow so you don’t miss the launch', W / 2, 1840, { size: 32, weight: 700, color: '#c9dbd0', alpha: outCubic(prog(t, 30.6, 31.0)) })
}

// ---------- master timeline ----------
export function draw(c: Ctx, t: number) {
  const energy = t >= DROP ? 0.6 + pulse(t) * 0.4 : 0.15
  c.save()
  const sh = shake(t)
  c.translate(sh.x, sh.y)
  if (t >= BREAK && t < BREAK + 0.3) {
    c.fillStyle = '#000'
    c.fillRect(-50, -50, W + 100, H + 100)
  } else {
    background(c, t, energy)
    if (t < 3.9) sceneHook(c, t)
    if (t >= 3.3 && t < 7.9) {
      c.save()
      c.globalAlpha = prog(t, 3.3, 3.6) * (1 - prog(t, 7.6, 7.9))
      sceneLogo(c, t)
      c.restore()
    }
    if (t >= 7.75 && t < 13.1) {
      c.save()
      c.globalAlpha = 1 - prog(t, 12.8, 13.1)
      sceneTracking(c, t)
      sectionLabel(c, '1', 'FILM YOUR GAME', t, 7.85, 12.95)
      c.restore()
    }
    if (t >= 12.95 && t < 16.9) {
      c.save()
      c.globalAlpha = 1 - prog(t, 16.6, 16.9)
      sceneGrades(c, t)
      sectionLabel(c, '2', 'EVERY SHOT GRADED', t, 13.0, 15.1)
      c.restore()
    }
    if (t >= 16.75 && t < 19.4) {
      c.save()
      c.globalAlpha = 1 - prog(t, 19.1, 19.4)
      sceneMomentum(c, t)
      sectionLabel(c, '3', 'SEE WHERE IT TURNED', t, 16.8, 19.25)
      c.restore()
    }
    if (t >= 19.25 && t < 23.3) {
      c.save()
      c.globalAlpha = 1 - prog(t, 23.0, 23.3)
      scene3D(c, t)
      sectionLabel(c, '4', 'REPLAY IN 3D', t, 19.3, 23.15)
      c.restore()
    }
    if (t >= 23.15 && t < BREAK) {
      c.save()
      c.globalAlpha = 1 - prog(t, 25.85, BREAK)
      sceneCoach(c, t)
      sectionLabel(c, '5', 'YOUR AI COACH', t, 23.2, BREAK)
      c.restore()
    }
    if (t >= BREAK && t < FINAL + 0.2) {
      c.save()
      c.globalAlpha = 1 - prog(t, FINAL - 0.1, FINAL + 0.2)
      sceneSlam(c, t)
      c.restore()
    }
    if (t >= FINAL - 0.05) sceneCTA(c, t)
    captions(c, t)
  }
  c.restore()
  overlays(c, t)
}
