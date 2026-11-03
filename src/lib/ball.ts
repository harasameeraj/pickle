// Lightweight ball finder: pickleballs are small, saturated yellow/green/orange blobs
// that move between frames. We look for moving, ball-coloured pixels on a small frame.

import type { Vec2 } from './types'

export class BallFinder {
  private prev: Uint8ClampedArray | null = null
  private last: Vec2 | null = null
  readonly w: number
  readonly h: number

  constructor(w = 320, h = 180) {
    this.w = w
    this.h = h
  }

  find(pixels: Uint8ClampedArray): Vec2 | null {
    const { w, h } = this
    const mask = new Uint8Array(w * h)
    const prev = this.prev
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const r = pixels[p]
      const g = pixels[p + 1]
      const b = pixels[p + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max < 120 || max - min < 70) continue
      // yellow / neon green / orange: blue is the smallest channel and red is substantial
      if (b !== min || r < 110) continue
      if (prev) {
        const d = Math.abs(r - prev[p]) + Math.abs(g - prev[p + 1]) + Math.abs(b - prev[p + 2])
        if (d < 60) continue
      }
      mask[i] = 1
    }
    this.prev = pixels.slice()
    // connected components (4-neighbour flood fill)
    const seen = new Uint8Array(w * h)
    const stack: number[] = []
    let best: { x: number; y: number; score: number } | null = null
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue
      let n = 0,
        sx = 0,
        sy = 0,
        minX = w,
        maxX = 0,
        minY = h,
        maxY = 0
      stack.push(i)
      seen[i] = 1
      while (stack.length) {
        const j = stack.pop()!
        const x = j % w
        const y = (j / w) | 0
        n++
        sx += x
        sy += y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        for (const k of [j - 1, j + 1, j - w, j + w]) {
          if (k < 0 || k >= w * h || seen[k] || !mask[k]) continue
          seen[k] = 1
          stack.push(k)
        }
      }
      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      if (n < 1 || n > 40 || bw > 9 || bh > 9) continue
      const roundness = Math.min(bw, bh) / Math.max(bw, bh)
      const c = { x: sx / n / w, y: sy / n / h }
      const near = this.last ? Math.hypot(c.x - this.last.x, c.y - this.last.y) : 0.3
      const score = roundness + Math.min(n, 12) / 12 - near * 2
      if (!best || score > best.score) best = { ...c, score }
    }
    this.last = best ? { x: best.x, y: best.y } : null
    return this.last
  }
}
