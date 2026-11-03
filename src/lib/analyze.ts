import { clamp, COURT_L, COURT_W, NET_Y, netDist, sigmoid } from './court'
import { applyRally, gameOver, initialScore } from './scoring'
import { posAt } from './track'
import type {
  BetterShot,
  Contact,
  EndKind,
  Grade,
  HitInput,
  Match,
  MatchSettings,
  Player,
  PlayerStats,
  Rally,
  RallyInput,
  Shot,
  ShotType,
  TeamId,
  TeamStats,
  Vec2,
} from './types'

export const GRADE_ORDER: Grade[] = [
  'brilliant',
  'great',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'missed',
  'blunder',
]

export const GRADE_SCORE: Record<Grade, number> = {
  brilliant: 100,
  great: 100,
  excellent: 92,
  good: 80,
  inaccuracy: 56,
  mistake: 32,
  missed: 38,
  blunder: 4,
}

export const SHOT_LABEL: Record<ShotType, string> = {
  serve: 'Serve',
  return: 'Return',
  drop: 'Third-shot drop',
  drive: 'Drive',
  dink: 'Dink',
  volley: 'Volley',
  speedup: 'Speed-up',
  reset: 'Reset',
  lob: 'Lob',
  overhead: 'Overhead',
}

const AGGRESSIVE: ShotType[] = ['speedup', 'overhead', 'drive']
const other = (t: TeamId): TeamId => (t === 0 ? 1 : 0)
const logit = (p: number) => Math.log(clamp(p, 0.02, 0.98) / (1 - clamp(p, 0.02, 0.98)))

interface Ctx {
  rally: RallyInput
  teamOf: (id: string) => TeamId
  partnersOf: (team: TeamId) => string[]
}

// ---------- Shot classification ----------

function classify(k: number, hits: HitInput[], types: ShotType[], ctx: Ctx): ShotType {
  const h = hits[k]
  if (h.typeHint) return h.typeHint
  if (k === 0) return 'serve'
  if (k === 1) return 'return'
  const prev = hits[k - 1]
  const next = hits[k + 1]
  const prevType = types[k - 1]
  const d = netDist(h.pos)
  const dt = next ? next.t - h.t : null
  const dtPrev = h.t - prev.t
  const nextRetreat = next ? netDist(next.pos) > 13 : false

  if (h.contact === 'high' && d < 14 && (dt === null || dt < 0.95)) return 'overhead'

  if (d <= 9) {
    if (dt !== null && dt > 2.2 && nextRetreat) return 'lob'
    if (dt === null) {
      if (h.contact === 'low') return prevType === 'speedup' || prevType === 'volley' ? 'volley' : 'dink'
      return prevType === 'speedup' || prevType === 'volley' || prevType === 'drive' ? 'volley' : 'speedup'
    }
    if (dt >= 1.0) return AGGRESSIVE.includes(prevType) || prevType === 'volley' ? 'reset' : 'dink'
    if (AGGRESSIVE.includes(prevType) || prevType === 'volley') return 'volley'
    return 'speedup'
  }
  if (d <= 15) {
    if (dt !== null && dt > 2.2 && nextRetreat) return 'lob'
    if (dtPrev < 0.8 && (dt === null || dt >= 0.9)) return 'reset'
    if (dt === null) return h.contact === 'low' ? 'reset' : 'drive'
    return dt >= 1.05 ? 'drop' : 'drive'
  }
  if (dt !== null && dt > 2.3 && nextRetreat) return 'lob'
  if (dt === null) return ctx.rally.endKind === 'net' && h.contact === 'low' ? 'drop' : 'drive'
  return dt >= 1.15 ? 'drop' : 'drive'
}

const APEX: Record<ShotType, number> = {
  serve: 6.2,
  return: 7,
  drop: 7.2,
  drive: 4.3,
  dink: 3.9,
  volley: 3.7,
  speedup: 3.9,
  reset: 3.8,
  lob: 17,
  overhead: 3.4,
}

function bounces(k: number, type: ShotType, next: HitInput | undefined): boolean {
  if (k <= 1) return true
  if (!next) return type !== 'volley'
  if (type === 'lob' || type === 'drop' || type === 'reset') return next.contact !== 'high'
  if (type === 'dink') return next.contact === 'low'
  if (type === 'drive') return netDist(next.pos) > 12
  return false
}

function opponentSideY(team: TeamId, depthFromNet: number) {
  return team === 0 ? NET_Y - depthFromNet : NET_Y + depthFromNet
}

function lastTarget(h: HitInput, team: TeamId, endKind: EndKind, won: boolean, ctx: Ctx, t: number): Vec2 {
  const opps = ctx.partnersOf(other(team))
    .map((id) => posAt(ctx.rally.track, id, t))
    .filter(Boolean) as Vec2[]
  if (!won) {
    if (endKind === 'net' || endKind === 'fault') return { x: clamp(h.pos.x + (10 - h.pos.x) * 0.2, 1, 19), y: NET_Y }
    const deep = team === 0 ? -3.5 : COURT_L + 3.5
    return { x: clamp(h.pos.x + (h.pos.x < 10 ? -6 : 6), -3, COURT_W + 3), y: deep }
  }
  // winner: put the ball into the biggest gap between opponents
  const gx =
    opps.length === 2
      ? Math.abs(opps[0].x - opps[1].x) > 6
        ? (opps[0].x + opps[1].x) / 2
        : opps[0].x < 10
          ? 17.5
          : 2.5
      : 10
  return { x: clamp(gx, 1.5, 18.5), y: opponentSideY(team, 12) }
}

// ---------- Quality, win probability and grades ----------

interface ShotDraft {
  hit: HitInput
  team: TeamId
  type: ShotType
  quality: number
  outcome?: Shot['outcome']
  missed: boolean
  lowSpeedup: boolean
}

function kitchenCount(ctx: Ctx, team: TeamId, t: number) {
  return ctx.partnersOf(team).reduce((n, id) => {
    const p = posAt(ctx.rally.track, id, t)
    return n + (p && netDist(p) <= 9 ? 1 : 0)
  }, 0)
}

function rallyWonWithin(drafts: ShotDraft[], k: number, n: number, winner: TeamId) {
  return drafts.length - 1 <= k + n && winner === drafts[k].team
}

function quality(k: number, drafts: ShotDraft[], ctx: Ctx): number {
  const s = drafts[k]
  const next = drafts[k + 1]
  const winner = ctx.rally.winner
  const isLast = k === drafts.length - 1
  if (isLast) {
    if (winner === s.team) return s.hit.contact === 'low' || netDist(s.hit.pos) > 9 ? 1 : 0.94
    const prev = drafts[k - 1]
    const forced =
      !!prev &&
      ((AGGRESSIVE.includes(prev.type) && (s.hit.t - prev.hit.t < 0.8 || prev.hit.contact === 'high')) ||
        prev.type === 'overhead')
    s.outcome = forced ? 'forced' : 'unforced'
    return forced ? 0.28 : 0
  }
  const nextAttack = AGGRESSIVE.includes(next.type) && netDist(next.hit.pos) <= 15
  const nextHigh = next.hit.contact === 'high'
  const nextLow = next.hit.contact === 'low'
  const oppErrNext = k + 1 === drafts.length - 1 && winner === s.team
  const lostSoon = rallyWonWithin(drafts, k, 2, other(s.team)) && winner !== s.team
  let q = 0.6

  switch (s.type) {
    case 'serve':
      q = netDist(next.hit.pos) > 19 ? 0.7 : 0.55
      break
    case 'return': {
      const third = drafts[k + 2]
      q = third && netDist(third.hit.pos) >= 19 ? 0.72 : 0.52
      const tCheck = third ? third.hit.t + 0.6 : s.hit.t + 2.5
      const me = posAt(ctx.rally.track, s.hit.hitter, tCheck)
      if (me) q += netDist(me) <= 10 ? 0.12 : -0.2
      break
    }
    case 'drop':
      q = nextAttack ? 0.3 : nextLow ? 0.86 : nextHigh ? 0.42 : 0.68
      break
    case 'drive':
      if (nextAttack && netDist(next.hit.pos) <= 9) q = 0.35
      else if (['drop', 'reset', 'lob', 'dink'].includes(next.type) && next.hit.contact !== 'low') q = 0.82
      else q = 0.56
      if (k === 2 && kitchenCount(ctx, other(s.team), s.hit.t) === 2) q -= 0.1
      break
    case 'dink':
      q = nextHigh ? 0.3 : nextLow ? 0.78 : 0.62
      if (nextAttack && lostSoon) q = 0.24
      break
    case 'speedup':
      q = 0.58
      if (next.type === 'volley' && lostSoon) q = 0.22
      if (s.hit.contact === 'low') {
        q -= 0.2
        s.lowSpeedup = true
      }
      break
    case 'volley':
      q = s.hit.contact === 'low' ? 0.5 : nextHigh ? 0.36 : 0.68
      if (lostSoon) q -= 0.15
      break
    case 'reset':
      q = !nextAttack && !nextHigh ? 0.88 : 0.4
      break
    case 'lob':
      q = next.type === 'overhead' ? 0.15 : netDist(next.hit.pos) > 15 ? 0.8 : 0.5
      break
    case 'overhead':
      q = nextAttack ? 0.42 : 0.66
      break
  }
  if (oppErrNext) q += 0.15
  if (
    s.hit.contact === 'high' &&
    netDist(s.hit.pos) <= 10 &&
    ['dink', 'reset', 'drop'].includes(s.type)
  ) {
    s.missed = true
    q = Math.min(q, 0.36)
  }
  return clamp(q, 0, 1)
}

function gradeFor(s: ShotDraft, isLast: boolean, won: boolean, wpBeforeH: number, wpAfterH: number, prev?: ShotDraft): Grade {
  const difficult =
    s.hit.contact === 'low' || netDist(s.hit.pos) > 9 || ['reset', 'lob', 'drop'].includes(s.type)
  if (isLast && won) {
    if (wpBeforeH < 0.3 && difficult) return 'brilliant'
    return wpBeforeH > 0.72 ? 'excellent' : 'great'
  }
  if (isLast && !won) {
    if (s.outcome === 'forced') {
      return prev && (prev.type === 'overhead' || prev.hit.contact === 'high') ? 'good' : 'inaccuracy'
    }
    return 'blunder'
  }
  if (s.missed) return 'missed'
  if (wpBeforeH < 0.3 && wpAfterH > 0.5 && s.quality >= 0.86 && ['reset', 'lob', 'drop'].includes(s.type))
    return 'brilliant'
  const q = s.quality
  if (q >= 0.88) return wpAfterH - wpBeforeH > 0.14 ? 'great' : 'excellent'
  if (q >= 0.74) return 'excellent'
  if (q >= 0.57) return 'good'
  if (q >= 0.41) return 'inaccuracy'
  if (q >= 0.2) return 'mistake'
  return 'blunder'
}

// ---------- Coaching notes and better shots ----------

function opponentGapTarget(team: TeamId, depth: number, ctx: Ctx, t: number): Vec2 {
  const opps = ctx.partnersOf(other(team))
    .map((id) => posAt(ctx.rally.track, id, t))
    .filter(Boolean) as Vec2[]
  const x = opps.length === 2 ? (opps[0].x + opps[1].x) / 2 : 10
  return { x: clamp(x, 2, 18), y: opponentSideY(team, depth) }
}

function coachNote(s: ShotDraft, grade: Grade, k: number, drafts: ShotDraft[], ctx: Ctx): { note: string; better?: BetterShot } {
  const next = drafts[k + 1]
  const t = s.hit.t
  const kitchen = (d = 3) => opponentGapTarget(s.team, d, ctx, t)
  const deep = () => opponentGapTarget(s.team, 18.5, ctx, t)
  const good = ['brilliant', 'great', 'excellent', 'good'].includes(grade)

  if (grade === 'missed')
    return {
      note: 'That ball sat up above your shoulder at the kitchen line — a free put-away you sent back soft.',
      better: { type: 'overhead', target: kitchen(5), apex: 2.6, tip: 'Hit down at their feet or through the middle. High ball at the kitchen = finish it.' },
    }

  switch (s.type) {
    case 'serve':
      if (s.outcome === 'unforced')
        return {
          note: 'Service fault — a free point handed over.',
          better: { type: 'serve', target: deep(), apex: 6.2, tip: 'Take pace off and aim 3 ft inside the baseline. A serve in play beats an ace attempt.' },
        }
      return { note: good ? 'Deep serve that pinned the returner back.' : 'Short serve let the returner step in.' }
    case 'return':
      if (s.outcome === 'unforced')
        return {
          note: 'Missed return — the easiest point to give away.',
          better: { type: 'return', target: deep(), apex: 7.5, tip: 'Return high and deep down the middle; give yourself margin.' },
        }
      return good
        ? { note: 'Deep return and you followed it in — textbook.' }
        : {
            note: "Return didn't buy you time, or you didn't get to the kitchen line after it.",
            better: { type: 'return', target: deep(), apex: 8, tip: 'Hit it deep with a high arc, then sprint in and split-step at the kitchen line.' },
          }
    case 'drop':
      if (s.outcome === 'unforced')
        return {
          note: 'Drop missed into the net or long.',
          better: { type: 'drop', target: kitchen(3.5), apex: 7, tip: 'Lift from your legs, open the face and aim to land 2–3 ft into the kitchen.' },
        }
      return good
        ? { note: next && next.hit.contact === 'low' ? 'Unattackable drop — it made them hit up.' : 'Solid drop, neutralised the point.' }
        : {
            note: 'Drop floated up and gave them an attackable ball.',
            better: { type: 'drop', target: kitchen(3), apex: 6.2, tip: 'Softer touch: lower apex, land it in the kitchen, then take 2–3 steps in.' },
          }
    case 'drive':
      if (s.outcome === 'unforced')
        return {
          note: 'Drive missed — low-percentage from back there.',
          better: { type: 'drop', target: kitchen(3), apex: 6.8, tip: 'With both opponents at the line, a drop wins more than a drive.' },
        }
      return good
        ? { note: 'Heavy drive forced a weak reply.' }
        : {
            note: 'Drove into two players at the kitchen — they blocked it back at you.',
            better: { type: 'drop', target: kitchen(3), apex: 6.8, tip: 'Drop it into the kitchen and earn your way forward.' },
          }
    case 'dink':
      if (s.outcome === 'unforced')
        return {
          note: 'Dink into the net — unforced.',
          better: { type: 'dink', target: { ...kitchen(3.5), x: s.hit.pos.x < 10 ? 16 : 4 }, apex: 3.9, tip: 'Bend your knees, lift with the legs, aim cross-court where the net is lowest.' },
        }
      return good
        ? { note: 'Low dink — kept them hitting up.' }
        : {
            note: 'Dink sat up and invited the attack.',
            better: { type: 'dink', target: { ...kitchen(2.5), x: s.hit.pos.x < 10 ? 16 : 4 }, apex: 3.5, tip: 'Finish low with an open face. Land it at their feet, cross-court.' },
          }
    case 'speedup':
      if (s.lowSpeedup && ctx.rally.winner === s.team && k + 1 === drafts.length - 1)
        return {
          note: 'Speed-up from below the net — it worked this time, but it is a low-percentage gamble.',
          better: { type: 'dink', target: kitchen(2.5), apex: 3.6, tip: 'Make them hit up first. Attack balls you contact above the net.' },
        }
      if (s.outcome === 'unforced' || s.lowSpeedup || !good)
        return {
          note: s.lowSpeedup ? 'Sped up a ball from below the net — they had time to counter.' : 'Speed-up got countered.',
          better: { type: 'dink', target: kitchen(2.5), apex: 3.6, tip: 'Only speed up balls you contact above the net. Otherwise dink and wait.' },
        }
      return { note: 'Well-timed speed-up at the body.' }
    case 'volley':
      if (s.outcome === 'unforced' || !good)
        return {
          note: 'Volley exchange lost — swing was too big.',
          better: { type: 'reset', target: kitchen(2), apex: 3.5, tip: 'Shorten the swing, paddle out front, block it back soft.' },
        }
      return { note: 'Quick hands in the firefight.' }
    case 'reset':
      return good
        ? { note: 'Calm reset under pressure — turned defence into neutral.' }
        : {
            note: 'Reset popped up too high.',
            better: { type: 'reset', target: kitchen(2), apex: 3.4, tip: 'Soft grip, absorb the pace, keep the paddle low and out front.' },
          }
    case 'lob':
      return good
        ? { note: 'Lob over their heads pushed them off the line.' }
        : {
            note: 'Lob was short — easy overhead for them.',
            better: { type: 'dink', target: kitchen(3), apex: 3.7, tip: 'Lob only when both opponents are leaning in; otherwise keep it low.' },
          }
    case 'overhead':
      if (s.outcome === 'unforced')
        return {
          note: 'Overhead missed.',
          better: { type: 'overhead', target: kitchen(6), apex: 3, tip: 'Point at the ball with your free hand, hit down at their feet — not the lines.' },
        }
      return { note: good ? 'Put-away with authority.' : 'Overhead came back — aim at feet, not chest.' }
  }
}

// ---------- Build the match ----------

export function analyzeRally(
  input: RallyInput,
  index: number,
  scoreBefore: Rally['scoreBefore'],
  players: Player[],
): Rally {
  const teamOf = (id: string) => players.find((p) => p.id === id)?.team ?? 0
  const partnersOf = (team: TeamId) => players.filter((p) => p.team === team).map((p) => p.id)
  const ctx: Ctx = { rally: input, teamOf, partnersOf }
  const hits = input.hits

  const types: ShotType[] = []
  for (let k = 0; k < hits.length; k++) types.push(classify(k, hits, types, ctx))

  const drafts: ShotDraft[] = hits.map((hit, k) => ({
    hit,
    team: teamOf(hit.hitter),
    type: types[k],
    quality: 0,
    missed: false,
    lowSpeedup: false,
  }))
  for (let k = 0; k < drafts.length; k++) drafts[k].quality = quality(k, drafts, ctx)

  const shots: Shot[] = []
  let wp0 = scoreBefore.serving === 0 ? 0.46 : 0.54
  for (let k = 0; k < drafts.length; k++) {
    const s = drafts[k]
    const isLast = k === drafts.length - 1
    const won = input.winner === s.team
    const wpBeforeH = s.team === 0 ? wp0 : 1 - wp0
    let wpAfterH: number
    if (isLast) wpAfterH = won ? 1 : 0
    else {
      const tAfter = drafts[k + 1].hit.t
      const pos = kitchenCount(ctx, s.team, tAfter) - kitchenCount(ctx, other(s.team), tAfter)
      wpAfterH = sigmoid(0.8 * logit(wpBeforeH) + 0.3 * pos + 2.6 * (s.quality - 0.66))
    }
    const grade = gradeFor(s, isLast, won, wpBeforeH, wpAfterH, drafts[k - 1])
    const { note, better } = coachNote(s, grade, k, drafts, ctx)
    const next = hits[k + 1]
    const target = next ? next.pos : lastTarget(s.hit, s.team, input.endKind, won, ctx, s.hit.t)
    const apex = isLast && !won && (input.endKind === 'net' || input.endKind === 'fault') ? 3.3 : APEX[s.type]
    const wpAfter0 = s.team === 0 ? wpAfterH : 1 - wpAfterH
    shots.push({
      index: k,
      t: s.hit.t,
      hitter: s.hit.hitter,
      team: s.team,
      pos: s.hit.pos,
      contact: s.hit.contact,
      type: s.type,
      target,
      apex,
      bounces: bounces(k, s.type, next),
      wpBefore: wp0,
      wpAfter: wpAfter0,
      quality: s.quality,
      grade,
      note,
      better,
      outcome: isLast ? (won ? 'winner' : s.outcome) : undefined,
    })
    wp0 = wpAfter0
  }

  let keyShot = 0
  let swing = 0
  shots.forEach((s, i) => {
    const d = Math.abs(s.wpAfter - s.wpBefore)
    const weight = s.grade === 'brilliant' || s.grade === 'blunder' || s.grade === 'missed' ? 1.4 : 1
    if (d * weight > swing) {
      swing = d * weight
      keyShot = i
    }
  })

  const { next: scoreAfter, pointScored } = applyRally(scoreBefore, input.winner)
  return {
    id: `r${index}`,
    index,
    start: input.start,
    end: input.end,
    scoreBefore,
    scoreAfter,
    winner: input.winner,
    endKind: input.endKind,
    pointScored,
    shots,
    track: input.track,
    keyShot,
    swing,
  }
}

export function buildMatch(args: {
  id: string
  title: string
  source: Match['source']
  players: Player[]
  settings: MatchSettings
  rallies: RallyInput[]
  duration: number
  videoKey?: string
  corners?: Vec2[]
  videoAspect?: number
}): Match {
  const { players, settings } = args
  let score = initialScore(settings.firstServer)
  const rallies: Rally[] = []
  let winner: TeamId | null = null
  for (const input of args.rallies) {
    if (!input.hits.length) continue
    const r = analyzeRally(input, rallies.length, score, players)
    rallies.push(r)
    score = r.scoreAfter
    winner = gameOver(score, settings.gameTo)
    if (winner !== null) break
  }
  const stats: Record<string, PlayerStats> = {}
  for (const p of players) stats[p.id] = playerStats(p, rallies)
  const teamStats: [TeamStats, TeamStats] = [teamStatsFor(0, players, rallies), teamStatsFor(1, players, rallies)]
  return {
    id: args.id,
    createdAt: Date.now(),
    title: args.title,
    source: args.source,
    videoKey: args.videoKey,
    duration: args.duration,
    players,
    settings,
    rallies,
    finalScore: score.points,
    winner,
    stats,
    teamStats,
    corners: args.corners,
    videoAspect: args.videoAspect,
  }
}

// ---------- Stats ----------

const emptyGrades = (): Record<Grade, number> =>
  Object.fromEntries(GRADE_ORDER.map((g) => [g, 0])) as Record<Grade, number>

export function playerStats(p: Player, rallies: Rally[]): PlayerStats {
  const st: PlayerStats = {
    playerId: p.id,
    shots: 0,
    accuracy: 0,
    grades: emptyGrades(),
    shotMix: {},
    winners: 0,
    unforced: 0,
    forced: 0,
    serveIn: 0,
    serveTotal: 0,
    returnDeep: 0,
    returnTotal: 0,
    kitchenArrivals: 0,
    kitchenChances: 0,
    dropsGood: 0,
    dropsTotal: 0,
    dinks: 0,
    dinkErrors: 0,
    speedups: 0,
    speedupsWon: 0,
    missedPutaways: 0,
    avgNetDist: 0,
    heat: new Array(110).fill(0),
  }
  let accSum = 0
  let best = -1
  let worst = 2
  let distSum = 0
  let distN = 0
  for (const r of rallies) {
    const shots = r.shots
    for (let k = 0; k < shots.length; k++) {
      const s = shots[k]
      if (s.hitter !== p.id) continue
      st.shots++
      st.grades[s.grade]++
      st.shotMix[s.type] = (st.shotMix[s.type] ?? 0) + 1
      accSum += 0.65 * GRADE_SCORE[s.grade] + 35 * s.quality
      if (s.outcome === 'winner') st.winners++
      if (s.outcome === 'unforced') st.unforced++
      if (s.outcome === 'forced') st.forced++
      if (s.type === 'serve') {
        st.serveTotal++
        if (!(k === shots.length - 1 && r.winner !== s.team)) st.serveIn++
      }
      if (s.type === 'return') {
        st.returnTotal++
        const third = shots[k + 1]
        if (third && netDist(third.pos) >= 19) st.returnDeep++
      }
      if (s.type === 'drop' && k === 2) {
        st.dropsTotal++
        if (s.quality >= 0.6) st.dropsGood++
      }
      if (s.type === 'dink') {
        st.dinks++
        if (s.outcome === 'unforced') st.dinkErrors++
      }
      if (s.type === 'speedup') {
        st.speedups++
        if (r.winner === s.team && shots.length - 1 <= k + 2) st.speedupsWon++
      }
      if (s.grade === 'missed') st.missedPutaways++
      const score = GRADE_SCORE[s.grade] + s.quality * 10
      if (score > best) {
        best = score
        st.bestShot = { rally: r.index, shot: k }
      }
      if (score < worst || worst === 2) {
        worst = score
        st.worstShot = { rally: r.index, shot: k }
      }
      // kitchen arrival after return (receiving team) or after third shot (serving team)
      if ((s.type === 'return' && k === 1) || (k === 2 && (s.type === 'drop' || s.type === 'drive'))) {
        const checkShot = shots[k + 2]
        const tCheck = checkShot ? checkShot.t : s.t + 2.6
        if (shots.length > k + 1) {
          st.kitchenChances++
          const pos = posAt(r.track, p.id, tCheck)
          if (pos && netDist(pos) <= 10) st.kitchenArrivals++
        }
      }
    }
    for (const sample of r.track) {
      const pos = sample.pos[p.id]
      if (!pos) continue
      const d = netDist(pos)
      distSum += d
      distN++
      const row = clamp(Math.floor(d / 2), 0, 10)
      const col = clamp(Math.floor((p.team === 0 ? pos.x : COURT_W - pos.x) / 2), 0, 9)
      st.heat[row * 10 + col]++
    }
  }
  st.accuracy = st.shots ? Math.round(clamp(accSum / st.shots, 0, 100)) : 0
  st.avgNetDist = distN ? distSum / distN : 0
  return st
}

export function teamStatsFor(team: TeamId, players: Player[], rallies: Rally[]): TeamStats {
  const ids = players.filter((p) => p.team === team).map((p) => p.id)
  let rallyWins = 0,
    pointsOnServe = 0,
    serveRallies = 0,
    sideOutsWon = 0,
    returnRallies = 0,
    both = 0,
    split = 0,
    samples = 0,
    spacing = 0,
    shortN = 0,
    shortW = 0,
    longN = 0,
    longW = 0,
    dinkN = 0,
    dinkW = 0
  for (const r of rallies) {
    const won = r.winner === team
    if (won) rallyWins++
    if (r.scoreBefore.serving === team) {
      serveRallies++
      if (won) pointsOnServe++
    } else {
      returnRallies++
      if (won) sideOutsWon++
    }
    const n = r.shots.length
    if (n <= 5) {
      shortN++
      if (won) shortW++
    }
    if (n >= 10) {
      longN++
      if (won) longW++
    }
    if (r.shots.filter((s) => s.type === 'dink').length >= 4) {
      dinkN++
      if (won) dinkW++
    }
    const established = r.shots[3]?.t ?? Infinity
    if (ids.length === 2) {
      for (const sm of r.track) {
        if (sm.t < established) continue
        const a = sm.pos[ids[0]]
        const b = sm.pos[ids[1]]
        if (!a || !b) continue
        samples++
        const da = netDist(a)
        const db = netDist(b)
        if (da <= 9 && db <= 9) both++
        else if ((da <= 9 && db > 12) || (db <= 9 && da > 12)) split++
        spacing += Math.abs(a.x - b.x)
      }
    }
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
  return {
    team,
    rallyWins,
    pointsOnServe,
    serveRallies,
    sideOutsWon,
    returnRallies,
    bothAtKitchenPct: pct(both, samples),
    splitPct: pct(split, samples),
    avgSpacing: samples ? spacing / samples : 0,
    shortRallyWinPct: pct(shortW, shortN),
    longRallyWinPct: pct(longW, longN),
    dinkRallyWinPct: pct(dinkW, dinkN),
  }
}

/** Win probability series for team 0 across the whole match: one point per shot. */
export function momentumSeries(m: Match) {
  const pts: { rally: number; shot: number; wp: number; grade: Grade; team: TeamId }[] = []
  for (const r of m.rallies) {
    for (const s of r.shots) pts.push({ rally: r.index, shot: s.index, wp: s.wpAfter, grade: s.grade, team: s.team })
  }
  return pts
}

export function contactLabel(c: Contact) {
  return c === 'low' ? 'below the net' : c === 'high' ? 'above the shoulder' : 'waist height'
}
