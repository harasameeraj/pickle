// Game-level win probability, like a chess evaluation graph.
// Between rallies it is the chance of winning the game from the current score
// (side-out scoring, solved by value iteration). Inside a rally it blends the
// "win this rally" and "lose this rally" outcomes by the rally win probability.

import { applyRally } from './scoring'
import type { Grade, Match, Score, TeamId } from './types'

function solver(gameTo: number, pServe: number) {
  const cap = gameTo + 1
  const norm = (a: number, b: number): [number, number] => {
    // deuce states are equivalent once both teams are at gameTo-1 or above
    if (a >= gameTo - 1 && b >= gameTo - 1) {
      const d = Math.min(a, b) - (gameTo - 1)
      return [a - d, b - d]
    }
    return [Math.min(a, cap), Math.min(b, cap)]
  }
  const key = (s: Score) => {
    const [a, b] = norm(s.points[0], s.points[1])
    return `${a},${b},${s.serving},${s.server}`
  }
  const done = (s: Score): number | null => {
    const [a, b] = s.points
    if (a >= gameTo && a - b >= 2) return 1
    if (b >= gameTo && b - a >= 2) return 0
    return null
  }
  const V = new Map<string, number>()
  const states: Score[] = []
  for (let a = 0; a <= cap; a++)
    for (let b = 0; b <= cap; b++)
      for (const serving of [0, 1] as TeamId[])
        for (const server of [1, 2] as const) {
          const s: Score = { points: [a, b], serving, server }
          if (done(s) === null) {
            states.push(s)
            V.set(key(s), 0.5)
          }
        }
  const val = (s: Score) => done(s) ?? V.get(key(s)) ?? 0.5
  for (let it = 0; it < 150; it++) {
    for (const s of states) {
      const win = applyRally(s, s.serving).next
      const lose = applyRally(s, s.serving === 0 ? 1 : 0).next
      V.set(key(s), pServe * val(win) + (1 - pServe) * val(lose))
    }
  }
  return val
}

const cache = new Map<number, (s: Score) => number>()
/** P(team 0 wins the game) from a score. Serving team wins ~46% of rallies at rec level. */
export function gameWP(s: Score, gameTo: number) {
  if (!cache.has(gameTo)) cache.set(gameTo, solver(gameTo, 0.46))
  return cache.get(gameTo)!(s)
}

export interface MomentumPoint {
  x: number
  wp: number // P(team 0 wins the game)
  rally: number
  shot: number
  grade?: Grade
  team?: TeamId
  hitter?: string
}

export function momentum(m: Match): MomentumPoint[] {
  const pts: MomentumPoint[] = []
  let x = 0
  const gt = m.settings.gameTo
  for (const r of m.rallies) {
    const before = gameWP(r.scoreBefore, gt)
    const ifWin0 = gameWP(applyRally(r.scoreBefore, 0).next, gt)
    const ifWin1 = gameWP(applyRally(r.scoreBefore, 1).next, gt)
    pts.push({ x: x++, wp: before, rally: r.index, shot: -1 })
    for (const s of r.shots) {
      const wp = s.wpAfter * ifWin0 + (1 - s.wpAfter) * ifWin1
      pts.push({ x: x++, wp, rally: r.index, shot: s.index, grade: s.grade, team: s.team, hitter: s.hitter })
    }
  }
  return pts
}
