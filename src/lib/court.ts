import type { TeamId, Vec2 } from './types'

export const COURT_W = 20
export const COURT_L = 44
export const NET_Y = 22
export const KITCHEN = 7
export const NET_H = 3 // feet, roughly 34" at centre / 36" at posts

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)
export const netDist = (p: Vec2) => Math.abs(p.y - NET_Y)
export const sideOf = (p: Vec2): TeamId => (p.y >= NET_Y ? 0 : 1)
export const inKitchenZone = (p: Vec2) => netDist(p) <= KITCHEN + 2
export const inTransition = (p: Vec2) => netDist(p) > KITCHEN + 2 && netDist(p) < 17
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

/** Lines of the court as segments, in court feet. */
export function courtLines(): [Vec2, Vec2][] {
  const L: [Vec2, Vec2][] = [
    [{ x: 0, y: 0 }, { x: COURT_W, y: 0 }],
    [{ x: 0, y: COURT_L }, { x: COURT_W, y: COURT_L }],
    [{ x: 0, y: 0 }, { x: 0, y: COURT_L }],
    [{ x: COURT_W, y: 0 }, { x: COURT_W, y: COURT_L }],
    [{ x: 0, y: NET_Y - KITCHEN }, { x: COURT_W, y: NET_Y - KITCHEN }],
    [{ x: 0, y: NET_Y + KITCHEN }, { x: COURT_W, y: NET_Y + KITCHEN }],
    [{ x: COURT_W / 2, y: 0 }, { x: COURT_W / 2, y: NET_Y - KITCHEN }],
    [{ x: COURT_W / 2, y: NET_Y + KITCHEN }, { x: COURT_W / 2, y: COURT_L }],
  ]
  return L
}

// ---------- Homography (image <-> court) ----------

export type Mat3 = number[] // 9 entries, row-major

/** Solve the 3x3 homography H so that H * src ~ dst, from 4 point pairs. */
export function computeHomography(src: Vec2[], dst: Vec2[]): Mat3 {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  const h = solveLinear(A, b)
  return [...h, 1]
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const d = M[c][c] || 1e-12
    for (let k = c; k <= n; k++) M[c][k] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row) => row[n])
}

export function applyH(H: Mat3, p: Vec2): Vec2 {
  const w = H[6] * p.x + H[7] * p.y + H[8]
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  }
}

/** Corners in court feet, in the order the user taps them during calibration. */
export const CORNER_ORDER: { label: string; court: Vec2 }[] = [
  { label: 'Far left corner', court: { x: 0, y: 0 } },
  { label: 'Far right corner', court: { x: COURT_W, y: 0 } },
  { label: 'Near right corner', court: { x: COURT_W, y: COURT_L } },
  { label: 'Near left corner', court: { x: 0, y: COURT_L } },
]

export function homographies(imageCorners: Vec2[]) {
  const court = CORNER_ORDER.map((c) => c.court)
  return {
    toCourt: computeHomography(imageCorners, court),
    toImage: computeHomography(court, imageCorners),
  }
}

export const TEAM_NAMES: [string, string] = ['Near team', 'Far team']
export const TEAM_COLORS: [string, string] = ['#d4ff3a', '#38bdf8']
export const PLAYER_COLORS = ['#d4ff3a', '#a3e635', '#38bdf8', '#818cf8']
