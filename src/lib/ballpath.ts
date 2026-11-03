// Reconstructs a plausible 3D ball flight from the shot list. Each shot flies from the
// hitter's contact point to the next contact (or its landing point), with an apex that
// depends on the shot type and a bounce where the rules or the situation require it.

import { lerp, NET_H, NET_Y } from './court'
import type { Contact, Rally, Shot, ShotType, Vec2 } from './types'

export interface Ball3 {
  x: number
  y: number
  h: number
}

const CONTACT_H: Record<Contact, number> = { low: 1.3, mid: 3, high: 6.4 }
export const FLIGHT: Record<ShotType, number> = {
  serve: 1.4,
  return: 1.5,
  drop: 1.4,
  drive: 0.8,
  dink: 1.2,
  volley: 0.5,
  speedup: 0.55,
  reset: 1.0,
  lob: 2.3,
  overhead: 0.55,
}

export interface Segment {
  t0: number
  t1: number
  from: Vec2
  to: Vec2
  h0: number
  h1: number
  apex: number
  bounce?: { u: number; at: Vec2; apex2: number }
  /** Extra roll-out after the final landing (winners). */
  tail?: { to: Vec2; t1: number }
  netStop?: boolean
}

export function contactHeight(s: Shot) {
  return s.type === 'serve' ? 2 : CONTACT_H[s.contact]
}

function arcHeight(h0: number, h1: number, apex: number, u: number) {
  const base = lerp(h0, h1, u)
  const lift = Math.max(0, apex - Math.max(h0, h1))
  return base + 4 * lift * u * (1 - u)
}

export function buildSegments(r: Rally): Segment[] {
  const segs: Segment[] = []
  r.shots.forEach((s, k) => {
    const next = r.shots[k + 1]
    const last = !next
    const t0 = s.t
    const t1 = next ? next.t : s.t + FLIGHT[s.type]
    const h0 = contactHeight(s)
    let h1 = next ? contactHeight(next) : 0
    let apex = s.apex
    const from = s.pos
    const to = s.target
    const netStop = last && r.winner !== s.team && Math.abs(to.y - NET_Y) < 0.5
    if (netStop) h1 = 1.6
    // make sure the ball clears the net when it should
    if (!netStop && (from.y - NET_Y) * (to.y - NET_Y) < 0) {
      const u = (from.y - NET_Y) / (from.y - to.y)
      const bu = s.bounces && !last ? 0.8 : 1
      const hNet = arcHeight(h0, s.bounces && !last ? 0 : h1, apex, Math.min(1, u / bu))
      if (hNet < NET_H + 0.35) apex += NET_H + 0.35 - hNet + 0.2
    }
    const seg: Segment = { t0, t1, from, to, h0, h1, apex, netStop }
    if (s.bounces && !last && !netStop) {
      const u = s.type === 'dink' || s.type === 'drop' || s.type === 'reset' ? 0.72 : 0.8
      seg.bounce = { u, at: { x: lerp(from.x, to.x, u), y: lerp(from.y, to.y, u) }, apex2: Math.max(h1 + 0.8, apex * 0.38) }
    }
    if (last && r.winner === s.team) {
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.hypot(dx, dy) || 1
      seg.tail = { to: { x: to.x + (dx / len) * 9, y: to.y + (dy / len) * 9 }, t1: t1 + 0.7 }
    }
    segs.push(seg)
  })
  return segs
}

export function ballAt(segs: Segment[], t: number): Ball3 | null {
  if (!segs.length || t < segs[0].t0) return null
  for (const s of segs) {
    const end = s.tail ? s.tail.t1 : s.t1
    if (t > end) continue
    if (t >= s.t1 && s.tail) {
      const u = (t - s.t1) / (s.tail.t1 - s.t1)
      return { x: lerp(s.to.x, s.tail.to.x, u), y: lerp(s.to.y, s.tail.to.y, u), h: 4 * 1.6 * u * (1 - u) }
    }
    const u = Math.max(0, Math.min(1, (t - s.t0) / (s.t1 - s.t0)))
    if (s.bounce) {
      const b = s.bounce
      // ball slows a little after the bounce: first leg uses 70% of the time
      const split = 0.7
      if (u <= split) {
        const v = u / split
        return { x: lerp(s.from.x, b.at.x, v), y: lerp(s.from.y, b.at.y, v), h: arcHeight(s.h0, 0, s.apex, v) }
      }
      const v = (u - split) / (1 - split)
      return { x: lerp(b.at.x, s.to.x, v), y: lerp(b.at.y, s.to.y, v), h: arcHeight(0, s.h1, b.apex2, v) }
    }
    if (s.netStop && u > 0.85) {
      const v = (u - 0.85) / 0.15
      return { x: s.to.x, y: s.to.y + (s.from.y > NET_Y ? 0.4 : -0.4) * v, h: Math.max(0.12, s.h1 * (1 - v)) }
    }
    return { x: lerp(s.from.x, s.to.x, u), y: lerp(s.from.y, s.to.y, u), h: arcHeight(s.h0, s.h1, s.apex, u) }
  }
  return null
}

/** Sampled points of a single arc (for ghost / comparison lines). */
export function arcPoints(from: Vec2, h0: number, to: Vec2, apex: number, bounceU?: number, n = 40): Ball3[] {
  const pts: Ball3[] = []
  const end = bounceU ?? 1
  for (let i = 0; i <= n; i++) {
    const u = i / n
    pts.push({ x: lerp(from.x, to.x, u * end), y: lerp(from.y, to.y, u * end), h: arcHeight(h0, 0, apex, u) })
  }
  return pts
}

export function rallyEnd(r: Rally) {
  const segs = buildSegments(r)
  const last = segs[segs.length - 1]
  return last ? (last.tail ? last.tail.t1 : last.t1) + 0.4 : r.end
}
