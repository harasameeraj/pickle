import type { Score, TeamId } from './types'

/** Traditional side-out doubles scoring. The game starts at 0-0-2. */
export function initialScore(firstServer: TeamId): Score {
  return { points: [0, 0], serving: firstServer, server: 2 }
}

export function applyRally(s: Score, winner: TeamId): { next: Score; pointScored: boolean } {
  const points: [number, number] = [s.points[0], s.points[1]]
  if (winner === s.serving) {
    points[winner] += 1
    return { next: { points, serving: s.serving, server: s.server }, pointScored: true }
  }
  if (s.server === 1) return { next: { points, serving: s.serving, server: 2 }, pointScored: false }
  const other: TeamId = s.serving === 0 ? 1 : 0
  return { next: { points, serving: other, server: 1 }, pointScored: false }
}

export function gameOver(s: Score, gameTo: number): TeamId | null {
  const [a, b] = s.points
  if (a >= gameTo && a - b >= 2) return 0
  if (b >= gameTo && b - a >= 2) return 1
  return null
}

/** Score call from the serving team's perspective, e.g. "4-2-1". */
export function callScore(s: Score): string {
  const us = s.points[s.serving]
  const them = s.points[s.serving === 0 ? 1 : 0]
  return `${us}-${them}-${s.server}`
}

export function spokenScore(s: Score): string {
  const us = s.points[s.serving]
  const them = s.points[s.serving === 0 ? 1 : 0]
  return `${us}, ${them}, ${s.server}`
}
