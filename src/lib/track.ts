import type { TrackSample, Vec2 } from './types'

/** Interpolated position of a player at time t from a track. */
export function posAt(track: TrackSample[], id: string, t: number): Vec2 | null {
  if (!track.length) return null
  let lo = 0
  let hi = track.length - 1
  if (t <= track[0].t) return track[0].pos[id] ?? null
  if (t >= track[hi].t) return track[hi].pos[id] ?? null
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (track[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = track[lo].pos[id]
  const b = track[hi].pos[id]
  if (!a) return b ?? null
  if (!b) return a
  const f = (t - track[lo].t) / (track[hi].t - track[lo].t || 1)
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

/** Index of the last sample with sample.t <= t. */
export function sampleIndex(track: { t: number }[], t: number): number {
  let lo = 0
  let hi = track.length - 1
  if (hi < 0 || t <= track[0].t) return 0
  if (t >= track[hi].t) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (track[mid].t <= t) lo = mid
    else hi = mid
  }
  return lo
}
