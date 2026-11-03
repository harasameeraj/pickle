// Simulates a realistic doubles game so the full review experience works without a video.
// Each player has tendencies (dink consistency, drop quality, kitchen habits...) so the
// review surfaces coherent, coachable patterns.

import { buildMatch } from './analyze'
import { clamp, NET_Y, PLAYER_COLORS } from './court'
import { applyRally, gameOver, initialScore } from './scoring'
import type { Contact, EndKind, HitInput, Match, Player, RallyInput, ShotType, TeamId, TrackSample, Vec2 } from './types'

interface Skill {
  serveErr: number
  returnErr: number
  kitchen: number // chance of getting to the kitchen after return / drop
  dropRate: number
  drop: number // drop quality 0–1
  dinkErr: number
  sitUp: number // chance a dink sits up for the opponent
  missPutaway: number
  reckless: number // speeds up balls from below the net
  hands: number // volley exchange strength
  reset: number
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Side = 'R' | 'L'
type Zone = 'base' | 'trans' | 'kitchen'
const DEPTH: Record<Zone, number> = { base: 21.8, trans: 13, kitchen: 8 }
const other = (t: TeamId): TeamId => (t === 0 ? 1 : 0)
const yFor = (team: TeamId, depth: number) => (team === 0 ? NET_Y + depth : NET_Y - depth)
const xFor = (team: TeamId, side: Side) => (team === 0 ? (side === 'R' ? 15 : 5) : side === 'R' ? 5 : 15)

export function demoPlayers(names = ['You', 'Jordan', 'Riley', 'Sam']): Player[] {
  return [
    { id: 'p1', name: names[0], team: 0, color: PLAYER_COLORS[0], isMe: true },
    { id: 'p2', name: names[1], team: 0, color: PLAYER_COLORS[1] },
    { id: 'p3', name: names[2], team: 1, color: PLAYER_COLORS[2] },
    { id: 'p4', name: names[3], team: 1, color: PLAYER_COLORS[3] },
  ]
}

const SKILLS: Record<string, Skill> = {
  p1: { serveErr: 0.04, returnErr: 0.04, kitchen: 0.55, dropRate: 0.55, drop: 0.55, dinkErr: 0.05, sitUp: 0.12, missPutaway: 0.3, reckless: 0.42, hands: 0.5, reset: 0.55 },
  p2: { serveErr: 0.03, returnErr: 0.03, kitchen: 0.9, dropRate: 0.8, drop: 0.68, dinkErr: 0.07, sitUp: 0.18, missPutaway: 0.1, reckless: 0.15, hands: 0.55, reset: 0.65 },
  p3: { serveErr: 0.05, returnErr: 0.05, kitchen: 0.85, dropRate: 0.7, drop: 0.62, dinkErr: 0.06, sitUp: 0.2, missPutaway: 0.12, reckless: 0.25, hands: 0.6, reset: 0.6 },
  p4: { serveErr: 0.06, returnErr: 0.05, kitchen: 0.75, dropRate: 0.35, drop: 0.45, dinkErr: 0.09, sitUp: 0.22, missPutaway: 0.15, reckless: 0.3, hands: 0.5, reset: 0.5 },
}

interface RallySim {
  hits: HitInput[]
  winner: TeamId
  endKind: EndKind
  way: Record<string, { t: number; p: Vec2 }[]>
  end: number
}

function simulateRally(
  rand: () => number,
  players: Player[],
  sides: Record<string, Side>,
  serving: TeamId,
  serverId: string,
): RallySim {
  const team = (id: string) => players.find((p) => p.id === id)!.team
  const partner = (id: string) => players.find((p) => p.team === team(id) && p.id !== id)!.id
  const teamIds = (t: TeamId) => players.filter((p) => p.team === t).map((p) => p.id)
  const zone: Record<string, Zone> = {}
  const way: RallySim['way'] = {}
  const hits: HitInput[] = []
  const jit = (a: number) => (rand() - 0.5) * a

  const receiving = other(serving)
  const returnerId = teamIds(receiving).find((id) => sides[id] === sides[serverId])!
  for (const p of players) {
    zone[p.id] = p.team === receiving && p.id !== returnerId ? 'kitchen' : 'base'
    way[p.id] = []
  }
  const home = (id: string): Vec2 => {
    const t = team(id)
    return { x: xFor(t, sides[id]) + jit(1.5), y: yFor(t, DEPTH[zone[id]] + (zone[id] === 'base' ? 0.6 : 0)) + jit(1) }
  }
  for (const p of players) {
    const h = home(p.id)
    way[p.id].push({ t: -1.5, p: h }, { t: 0, p: h })
  }

  let t = 0
  const settle = (at: number) => {
    for (const p of players) way[p.id].push({ t: at, p: home(p.id) })
  }
  const hit = (id: string, type: ShotType, contact: Contact, towardX?: number) => {
    const h = home(id)
    if (towardX !== undefined) h.x = clamp(h.x + (towardX - h.x) * 0.35, 1, 19)
    way[id].push({ t, p: h })
    hits.push({ t, hitter: id, pos: h, contact, typeHint: type })
  }
  const pickReceiver = (hitter: string) => {
    const opp = teamIds(other(team(hitter)))
    const diag = opp.find((id) => sides[id] === sides[hitter])!
    return rand() < 0.62 ? diag : opp.find((id) => id !== diag)!
  }
  const end = (winner: TeamId, kind: EndKind): RallySim => {
    settle(t + 1.2)
    return { hits, winner, endKind: kind, way, end: t + 1.2 }
  }
  const S = (id: string) => SKILLS[id]

  // 1. Serve
  hit(serverId, 'serve', 'low')
  if (rand() < S(serverId).serveErr) return end(receiving, 'fault')
  t += 1.5 + jit(0.2)
  // 2. Return
  hit(returnerId, 'return', 'low')
  if (rand() < S(returnerId).returnErr) return end(serving, rand() < 0.5 ? 'net' : 'out')
  zone[returnerId] = rand() < S(returnerId).kitchen ? 'kitchen' : 'trans'
  settle(t + 1.2)
  t += 1.6 + jit(0.2)

  // 3. Third shot
  let third = teamIds(serving)[rand() < 0.5 ? 0 : 1]
  const returnerStuck = zone[returnerId] !== 'kitchen'
  let attacker: string | null = null
  if (rand() < S(third).dropRate) {
    hit(third, 'drop', 'low')
    const q = S(third).drop + jit(0.5)
    if (q < 0.14) return end(receiving, 'net')
    if (q > 0.5) {
      for (const id of teamIds(serving)) zone[id] = rand() < S(id).kitchen + 0.1 ? 'kitchen' : 'trans'
    } else {
      for (const id of teamIds(serving)) zone[id] = 'trans'
      attacker = pickReceiver(third)
    }
    settle(t + 1.1)
    t += 1.45 + jit(0.2)
  } else {
    hit(third, 'drive', 'low')
    if (rand() < 0.08) return end(receiving, 'out')
    t += 0.85 + jit(0.1)
    if (returnerStuck) {
      // the returner never got in: the drive eats them up
      const r = pickReceiver(third)
      hit(r, 'reset', 'high')
      t += 1.0
      for (const id of teamIds(serving)) zone[id] = 'trans'
      settle(t)
      const finisher = teamIds(serving)[rand() < 0.5 ? 0 : 1]
      hit(finisher, 'drive', 'high')
      if (rand() < 0.68) return end(serving, 'winner')
      t += 0.6
      third = finisher
    } else {
      // blocked back by the volleyer, then fifth-shot drop
      const v = pickReceiver(third)
      hit(v, 'volley', 'mid')
      if (rand() < 0.12) return end(serving, 'net')
      t += 0.95
      const fifth = teamIds(serving)[rand() < 0.5 ? 0 : 1]
      hit(fifth, 'drop', 'low')
      if (rand() < 0.1) return end(receiving, 'net')
      for (const id of teamIds(serving)) zone[id] = rand() < S(id).kitchen ? 'kitchen' : 'trans'
      settle(t + 1)
      t += 1.4
      third = fifth
    }
  }

  // 4. Attack on a poor drop: serving team must reset from transition
  let lastHitter = third
  if (attacker) {
    hit(attacker, 'speedup', 'high')
    t += 0.6
    const defender = pickReceiver(attacker)
    if (rand() < 0.22) return end(team(attacker), 'winner')
    if (rand() < S(defender).reset) {
      hit(defender, 'reset', 'low')
      zone[defender] = 'kitchen'
      zone[partner(defender)] = 'kitchen'
      settle(t + 1.2)
      t += 1.15
      lastHitter = defender
    } else {
      hit(defender, 'volley', 'mid')
      return end(team(attacker), rand() < 0.5 ? 'net' : 'out')
    }
  }

  // 5. Dink battle and attacks
  for (const p of players) if (zone[p.id] !== 'kitchen' && rand() < 0.75) zone[p.id] = 'kitchen'
  settle(t)
  let prev = lastHitter
  let incomingHigh = false
  for (let n = 0; n < 26; n++) {
    const h = pickReceiver(prev)
    const sk = S(h)
    const contact: Contact = incomingHigh ? 'high' : 'low'
    if (contact === 'high') {
      if (rand() < sk.missPutaway) {
        hit(h, 'dink', 'high')
        incomingHigh = rand() < sk.sitUp
        t += 1.2 + jit(0.2)
        prev = h
        continue
      }
      hit(h, rand() < 0.5 ? 'overhead' : 'speedup', 'high')
      if (rand() < 0.58) return end(team(h), 'winner')
      t += 0.5
      return exchange(h, 0.2)
    }
    const r = rand()
    if (r < sk.reckless * 0.22) {
      hit(h, 'speedup', 'low')
      if (rand() < 0.15) return end(team(h), 'winner')
      t += 0.5
      return exchange(h, -0.2)
    }
    if (r < sk.reckless * 0.22 + 0.025) {
      hit(h, 'lob', 'low')
      t += 2.4
      const back = pickReceiver(h)
      if (rand() < 0.45) {
        hit(back, 'overhead', 'high')
        return end(team(back), 'winner')
      }
      zone[back] = 'trans'
      settle(t - 0.6)
      hit(back, 'reset', 'low')
      zone[back] = 'kitchen'
      settle(t + 1.3)
      t += 1.4
      prev = back
      incomingHigh = false
      continue
    }
    if (n > 3 && r > 0.94) {
      hit(h, 'speedup', 'mid')
      if (rand() < 0.3) return end(team(h), 'winner')
      t += 0.5
      return exchange(h, 0.05)
    }
    hit(h, 'dink', 'low', 10)
    if (rand() < sk.dinkErr) return end(other(team(h)), 'net')
    incomingHigh = rand() < sk.sitUp
    t += 1.25 + jit(0.25)
    prev = h
  }
  return end(other(team(prev)), 'net')

  function exchange(startHitter: string, adv: number): RallySim {
    let h = startHitter
    let a = adv
    for (let i = 0; i < 6; i++) {
      const responder = pickReceiver(h)
      const sk = S(responder)
      const errP = clamp(0.32 + a - sk.hands * 0.25, 0.08, 0.6)
      if (rand() < errP) {
        hit(responder, 'volley', 'mid')
        return end(team(h), rand() < 0.5 ? 'net' : 'out')
      }
      if (rand() < sk.reset * 0.3) {
        hit(responder, 'reset', 'mid')
        t += 1.1
        const d = pickReceiver(responder)
        hit(d, 'dink', 'low')
        if (rand() < S(d).dinkErr) return end(other(team(d)), 'net')
        t += 1.25
        const e = pickReceiver(d)
        hit(e, 'dink', 'low')
        return end(other(team(e)), 'net')
      }
      hit(responder, 'volley', 'mid')
      if (rand() < 0.2 + sk.hands * 0.15) return end(team(responder), 'winner')
      t += 0.45 + jit(0.08)
      h = responder
      a = -a * 0.5
    }
    return end(team(h), 'winner')
  }
}

function sampleTrack(way: RallySim['way'], start: number, from: number, to: number, rand: () => number): TrackSample[] {
  const out: TrackSample[] = []
  const sorted = Object.fromEntries(
    Object.entries(way).map(([id, w]) => [id, [...w].sort((a, b) => a.t - b.t)]),
  )
  for (let t = from; t <= to; t += 0.1) {
    const pos: Record<string, Vec2> = {}
    for (const [id, w] of Object.entries(sorted)) {
      let i = 0
      while (i < w.length - 1 && w[i + 1].t < t) i++
      const a = w[i]
      const b = w[Math.min(i + 1, w.length - 1)]
      const span = b.t - a.t
      const f = span > 0 ? clamp((t - a.t) / span, 0, 1) : 1
      const e = f * f * (3 - 2 * f)
      pos[id] = {
        x: a.p.x + (b.p.x - a.p.x) * e + (rand() - 0.5) * 0.08,
        y: a.p.y + (b.p.y - a.p.y) * e + (rand() - 0.5) * 0.08,
      }
    }
    out.push({ t: +(start + t).toFixed(2), pos })
  }
  return out
}

export function simulateMatch(seed = 7, names?: string[]): Match {
  const rand = mulberry32(seed)
  const players = demoPlayers(names)
  const settings = { gameTo: 11, firstServer: 0 as TeamId }
  const sides: Record<string, Side> = { p1: 'R', p2: 'L', p3: 'R', p4: 'L' }
  let score = initialScore(settings.firstServer)
  let serverId = players.find((p) => p.team === score.serving && sides[p.id] === 'R')!.id
  const rallies: RallyInput[] = []
  let clock = 6
  for (let guard = 0; guard < 120; guard++) {
    const sim = simulateRally(rand, players, sides, score.serving, serverId)
    const toAbs = (h: HitInput): HitInput => ({ ...h, t: +(clock + h.t).toFixed(2) })
    rallies.push({
      start: clock - 1,
      end: clock + sim.end,
      hits: sim.hits.map(toAbs),
      winner: sim.winner,
      endKind: sim.endKind,
      track: sampleTrack(sim.way, clock, -1, sim.end, rand),
    })
    const { next, pointScored } = applyRally(score, sim.winner)
    if (pointScored) {
      const ids = players.filter((p) => p.team === score.serving).map((p) => p.id)
      for (const id of ids) sides[id] = sides[id] === 'R' ? 'L' : 'R'
    } else if (next.serving !== score.serving) {
      serverId = players.find((p) => p.team === next.serving && sides[p.id] === 'R')!.id
    } else {
      serverId = players.find((p) => p.team === score.serving && p.id !== serverId)!.id
    }
    score = next
    clock += sim.end + 12 + rand() * 8
    if (gameOver(score, settings.gameTo) !== null) break
  }
  return buildMatch({
    id: `demo-${seed}`,
    title: 'Demo: Saturday doubles',
    source: 'demo',
    players,
    settings,
    rallies,
    duration: clock,
  })
}
