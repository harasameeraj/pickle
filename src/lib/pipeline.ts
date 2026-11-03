// Video -> rallies. Runs fully in the browser:
//  1. decode audio and find paddle pops
//  2. step through the video, run pose detection, locate the ball
//  3. map each player's feet onto the court and keep identities stable
//  4. turn pops + wrist motion into hits, hits into rallies

import { detectPops, decodeAudio, type Onset } from './audio'
import { BallFinder } from './ball'
import { applyH, homographies, netDist, sideOf } from './court'
import { applyRally, initialScore } from './scoring'
import type { Contact, HitInput, MatchSettings, Player, RallyInput, TeamId, TrackSample, Vec2 } from './types'
import { bodyScale, compactPose, feet, getPoseLandmarker, K, kp, nextTs } from './vision'

export interface PlayerSeed extends Player {
  /** Feet position in normalised image coords on the setup frame. */
  foot: Vec2
}

export interface RawAnalysis {
  duration: number
  aspect: number
  samples: TrackSample[]
  speed: Record<string, number[]>
  pops: Onset[] | null
}

export interface Progress {
  phase: string
  pct: number
  detail?: string
  preview?: { pose: Record<string, number[]>; ball: Vec2 | null; t: number }
}

/** MediaRecorder WebM files report duration=Infinity until the browser scans to the end. */
export async function ensureDuration(v: HTMLVideoElement) {
  if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }))
  if (Number.isFinite(v.duration)) return
  await new Promise<void>((res) => {
    const on = () => {
      if (!Number.isFinite(v.duration)) return
      v.removeEventListener('durationchange', on)
      v.currentTime = 0
      res()
    }
    v.addEventListener('durationchange', on)
    v.currentTime = 1e101
  })
}

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((res) => {
    const done = () => {
      v.removeEventListener('seeked', done)
      res()
    }
    v.addEventListener('seeked', done)
    v.currentTime = t
  })

export async function extract(
  video: HTMLVideoElement,
  file: Blob,
  corners: Vec2[],
  seeds: PlayerSeed[],
  opts: { fps: number; signal: AbortSignal; onProgress: (p: Progress) => void },
): Promise<RawAnalysis> {
  const { onProgress, signal, fps } = opts
  await ensureDuration(video)
  const H = homographies(corners).toCourt
  onProgress({ phase: 'Listening for paddle pops', pct: 1 })
  const audio = await decodeAudio(file)
  const pops = audio ? detectPops(audio.data, audio.rate) : null
  onProgress({ phase: 'Loading the AI vision model', pct: 4, detail: pops ? `${pops.length} pops heard` : 'No audio track' })
  const landmarker = await getPoseLandmarker('full', 6)

  const duration = video.duration
  const aspect = video.videoWidth / video.videoHeight
  const W = Math.min(960, video.videoWidth)
  const Hh = Math.round(W / aspect)
  const work = document.createElement('canvas')
  work.width = W
  work.height = Hh
  const wctx = work.getContext('2d', { willReadFrequently: true })!
  const finder = new BallFinder(320, Math.round(320 / aspect))
  const small = document.createElement('canvas')
  small.width = finder.w
  small.height = finder.h
  const sctx = small.getContext('2d', { willReadFrequently: true })!

  const last: Record<string, { pos: Vec2; t: number; color: number[] | null; pose?: number[] }> = {}
  for (const s of seeds) last[s.id] = { pos: applyH(H, s.foot), t: 0, color: null }
  const samples: TrackSample[] = []
  const speed: Record<string, number[]> = Object.fromEntries(seeds.map((s) => [s.id, []]))
  const step = 1 / fps
  const started = performance.now()

  const torsoColor = (pose: number[]) => {
    const a = kp(pose, K.lShoulder)
    const b = kp(pose, K.rHip)
    const x = Math.round(Math.min(a.x, b.x) * W)
    const y = Math.round(Math.min(a.y, b.y) * Hh)
    const w = Math.max(2, Math.round(Math.abs(a.x - b.x) * W))
    const h = Math.max(2, Math.round(Math.abs(a.y - b.y) * Hh))
    if (x < 0 || y < 0 || x + w > W || y + h > Hh) return null
    const d = wctx.getImageData(x, y, w, h).data
    let r = 0,
      g = 0,
      bl = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]
      g += d[i + 1]
      bl += d[i + 2]
    }
    const n = d.length / 4
    return [r / n, g / n, bl / n]
  }

  for (let t = 0, i = 0; t < duration; t += step, i++) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    await seek(video, t)
    wctx.drawImage(video, 0, 0, W, Hh)
    sctx.drawImage(video, 0, 0, finder.w, finder.h)
    const res = landmarker.detectForVideo(work, nextTs())
    const ball = finder.find(sctx.getImageData(0, 0, finder.w, finder.h).data)

    const cands = res.landmarks.map((lm) => {
      const pose = compactPose(lm)
      const court = applyH(H, feet(pose))
      return { pose, court, color: torsoColor(pose) }
    }).filter((c) => c.court.x > -7 && c.court.x < 27 && c.court.y > -9 && c.court.y < 53)

    const pairs: { pid: string; ci: number; cost: number }[] = []
    for (const s of seeds) {
      const L = last[s.id]
      const gate = 6 + 14 * (t - L.t)
      cands.forEach((c, ci) => {
        const d = Math.hypot(c.court.x - L.pos.x, c.court.y - L.pos.y)
        if (d > gate) return
        let cost = d
        if (sideOf(c.court) !== s.team) cost += 25
        if (L.color && c.color) cost += (Math.hypot(L.color[0] - c.color[0], L.color[1] - c.color[1], L.color[2] - c.color[2]) / 441) * 10
        pairs.push({ pid: s.id, ci, cost })
      })
    }
    pairs.sort((a, b) => a.cost - b.cost)
    const usedP = new Set<string>()
    const usedC = new Set<number>()
    const pos: Record<string, Vec2> = {}
    const pose: Record<string, number[]> = {}
    for (const p of pairs) {
      if (usedP.has(p.pid) || usedC.has(p.ci)) continue
      usedP.add(p.pid)
      usedC.add(p.ci)
      const c = cands[p.ci]
      const L = last[p.pid]
      // wrist speed in body-heights per second
      let sp = 0
      if (L.pose && t - L.t <= step * 1.5) {
        const sc = bodyScale(c.pose)
        for (const w of [K.lWrist, K.rWrist]) {
          const a = kp(c.pose, w)
          const b = kp(L.pose, w)
          sp = Math.max(sp, Math.hypot(a.x - b.x, a.y - b.y) / sc / (t - L.t))
        }
      }
      speed[p.pid][i] = sp
      L.pos = { x: +c.court.x.toFixed(2), y: +c.court.y.toFixed(2) }
      L.t = t
      L.pose = c.pose
      if (c.color) L.color = L.color ? L.color.map((v, k) => v * 0.95 + c.color![k] * 0.05) : c.color
      pose[p.pid] = c.pose
    }
    for (const s of seeds) {
      pos[s.id] = last[s.id].pos
      if (speed[s.id][i] === undefined) speed[s.id][i] = 0
    }
    samples.push({ t: +t.toFixed(2), pos, pose, ball })

    if (i % 5 === 0) {
      const pct = 5 + (t / duration) * 93
      const el = (performance.now() - started) / 1000
      const eta = (el / Math.max(t, 0.1)) * (duration - t)
      onProgress({
        phase: 'Tracking players and ball',
        pct,
        detail: `${fmt(t)} / ${fmt(duration)} · about ${fmt(eta)} left`,
        preview: { pose, ball, t },
      })
    }
  }
  onProgress({ phase: 'Finding rallies', pct: 99 })
  return { duration, aspect, samples, speed, pops }
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// ---------- Hits and rallies ----------

export interface HitDraft extends HitInput {
  evidence: Record<string, number>
}

export interface RallyDraft {
  id: string
  include: boolean
  start: number
  end: number
  hits: HitDraft[]
  winner: TeamId
  confidence: number
  track: TrackSample[]
}

function evidenceAt(raw: RawAnalysis, players: Player[], t: number, step: number): Record<string, number> {
  const i0 = Math.max(0, Math.floor((t - 0.25) / step))
  const i1 = Math.min(raw.samples.length - 1, Math.ceil((t + 0.25) / step))
  const ev: Record<string, number> = {}
  for (const p of players) {
    let m = 0
    for (let i = i0; i <= i1; i++) m = Math.max(m, raw.speed[p.id][i] ?? 0)
    ev[p.id] = m
  }
  return ev
}

function contactAt(raw: RawAnalysis, id: string, t: number, step: number): Contact {
  const s = raw.samples[Math.min(raw.samples.length - 1, Math.round(t / step))]
  const pose = s?.pose?.[id]
  if (!pose) return 'mid'
  const wrist = Math.min(kp(pose, K.lWrist).y, kp(pose, K.rWrist).y)
  const shoulder = (kp(pose, K.lShoulder).y + kp(pose, K.rShoulder).y) / 2
  const hip = (kp(pose, K.lHip).y + kp(pose, K.rHip).y) / 2
  if (wrist < shoulder) return 'high'
  if (wrist > hip) return 'low'
  return 'mid'
}

function posAtSample(raw: RawAnalysis, id: string, t: number, step: number): Vec2 {
  const s = raw.samples[Math.min(raw.samples.length - 1, Math.max(0, Math.round(t / step)))]
  return s.pos[id]
}

function assignHitters(hits: HitDraft[], players: Player[], firstTeam: TeamId) {
  hits.forEach((h, i) => {
    const team: TeamId = (i % 2 === 0 ? firstTeam : firstTeam === 0 ? 1 : 0) as TeamId
    const mates = players.filter((p) => p.team === team)
    let best = mates[0]
    for (const p of mates) if ((h.evidence[p.id] ?? 0) > (h.evidence[best.id] ?? 0)) best = p
    // the serve comes from the player behind the baseline
    if (i === 0) {
      const deep = [...mates].sort((a, b) => netDist(posOf(h, b.id)) - netDist(posOf(h, a.id)))[0]
      if ((h.evidence[deep.id] ?? 0) >= (h.evidence[best.id] ?? 0) * 0.6) best = deep
    }
    h.hitter = best.id
  })
}
const posStore = new WeakMap<HitDraft, Record<string, Vec2>>()
const posOf = (h: HitDraft, id: string) => posStore.get(h)?.[id] ?? h.pos

export function detectRallies(raw: RawAnalysis, players: Player[], fps: number): RallyDraft[] {
  const step = 1 / fps
  let times: { t: number; s: number }[] = []
  const hasPose = raw.samples.some((s) => s.pose && Object.keys(s.pose).length > 0)
  if (raw.pops && raw.pops.length >= 4) {
    times = raw.pops
      .map((p) => {
        const ev = evidenceAt(raw, players, p.t, step)
        return { t: p.t, s: Math.max(...Object.values(ev)) }
      })
      .filter((c) => !hasPose || c.s > 1.1)
  } else {
    // no usable audio: fall back to wrist-speed peaks
    for (let i = 1; i < raw.samples.length - 1; i++) {
      for (const p of players) {
        const v = raw.speed[p.id]
        if (v[i] > 3 && v[i] >= v[i - 1] && v[i] >= v[i + 1]) times.push({ t: raw.samples[i].t, s: v[i] })
      }
    }
    times.sort((a, b) => a.t - b.t)
    times = times.filter((c, i) => i === 0 || c.t - times[i - 1].t > 0.4)
  }

  const groups: { t: number; s: number }[][] = []
  for (const c of times) {
    const g = groups[groups.length - 1]
    if (g && c.t - g[g.length - 1].t < 4.5) g.push(c)
    else groups.push([c])
  }

  const drafts: RallyDraft[] = []
  for (const g of groups) {
    const hits: HitDraft[] = g.map((c) => {
      const ev = evidenceAt(raw, players, c.t, step)
      const h: HitDraft = { t: +c.t.toFixed(2), hitter: players[0].id, pos: { x: 10, y: 22 }, contact: 'mid', evidence: ev }
      posStore.set(h, Object.fromEntries(players.map((p) => [p.id, posAtSample(raw, p.id, c.t, step)])))
      return h
    })
    // pick which team served by maximising alternating evidence
    let bestTeam: TeamId = 0
    let bestScore = -1
    for (const first of [0, 1] as TeamId[]) {
      let sc = 0
      hits.forEach((h, i) => {
        const team = i % 2 === 0 ? first : first === 0 ? 1 : 0
        sc += Math.max(...players.filter((p) => p.team === team).map((p) => h.evidence[p.id] ?? 0))
      })
      if (sc > bestScore) {
        bestScore = sc
        bestTeam = first
      }
    }
    assignHitters(hits, players, bestTeam)
    for (const h of hits) {
      h.pos = posAtSample(raw, h.hitter, h.t, step)
      h.contact = contactAt(raw, h.hitter, h.t, step)
    }
    if (hits.length === 1 && netDist(hits[0].pos) < 17) continue // stray pop, not a serve

    const last = hits[hits.length - 1]
    const lastTeam = players.find((p) => p.id === last.hitter)!.team
    const aggressive = last.contact !== 'low' && netDist(last.pos) <= 10
    const winner: TeamId = hits.length === 1 ? (lastTeam === 0 ? 1 : 0) : aggressive ? lastTeam : lastTeam === 0 ? 1 : 0
    const start = Math.max(0, hits[0].t - 1.5)
    const end = Math.min(raw.duration, last.t + 1.8)
    drafts.push({
      id: `d${drafts.length}`,
      include: true,
      start,
      end,
      hits,
      winner,
      confidence: Math.min(1, (bestScore / Math.max(1, hits.length)) / 4),
      track: raw.samples.filter((s) => s.t >= start - 0.5 && s.t <= end + 0.5),
    })
  }
  return drafts
}

/** Apply verified winners, re-derive serving order and hitters, and produce engine input. */
export function finalizeRallies(drafts: RallyDraft[], players: Player[], settings: MatchSettings): RallyInput[] {
  let score = initialScore(settings.firstServer)
  const out: RallyInput[] = []
  for (const d of drafts) {
    if (!d.include || !d.hits.length) continue
    const hits = d.hits.map((h) => {
      const copy = { ...h }
      const store = posStore.get(h)
      if (store) posStore.set(copy, store)
      return copy
    })
    assignHitters(hits, players, score.serving)
    for (const h of hits) {
      const s = d.track.reduce((best, x) => (Math.abs(x.t - h.t) < Math.abs(best.t - h.t) ? x : best), d.track[0])
      if (s) h.pos = s.pos[h.hitter] ?? h.pos
    }
    out.push({
      start: d.start,
      end: d.end,
      hits: hits.map(({ evidence: _e, ...h }) => h),
      winner: d.winner,
      endKind: hits.length === 1 ? 'fault' : 'unknown',
      track: d.track,
    })
    score = applyRally(score, d.winner).next
  }
  return out
}
