// Real-time form analysis for Live Coach drills. Works on a single person's pose
// (13 keypoints, normalised image coords) streamed from the camera.

import type { Persona } from './coach'
import { angle, bodyScale, K, kp, mid } from './vision'

export interface Feedback {
  text: string
  tone: 'good' | 'bad'
  say?: string
}

export interface Metric {
  label: string
  value: string
  good: boolean
}

export interface DrillOutput {
  feedback?: Feedback
  badJoints: number[]
  metrics: Metric[]
  score: number
  reps: number
}

export interface RepResult {
  score: number
  faults: string[]
}

export interface DrillEngine {
  update(t: number, pose: number[]): DrillOutput
  repLog: RepResult[]
}

const PRAISE: Record<Persona, string[]> = {
  pro: ['Nice.', 'Good rep.', 'That’s it.', 'Clean.'],
  hype: ['Let’s go!', 'Money!', 'Filthy!', 'Yes!'],
  sarge: ['Acceptable.', 'Again.', 'Better.', 'Good. Again.'],
}
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]

const kneeAngle = (p: number[]) =>
  (angle(kp(p, K.lHip), kp(p, K.lKnee), kp(p, K.lAnkle)) + angle(kp(p, K.rHip), kp(p, K.rKnee), kp(p, K.rAnkle))) / 2

function torso(p: number[]) {
  const sh = mid(kp(p, K.lShoulder), kp(p, K.rShoulder))
  const hip = mid(kp(p, K.lHip), kp(p, K.rHip))
  return { shY: sh.y, hipY: hip.y, len: Math.max(0.02, hip.y - sh.y) }
}

interface Hist {
  t: number
  wrist: { x: number; y: number }
  speed: number
  knee: number
  scale: number
}

/** Shared swing/rep detection based on paddle-wrist speed peaks. */
class RepDetector {
  hist: Hist[] = []
  private armed = true
  private lastRep = -10
  private peak: Hist | null = null
  constructor(
    private hi: number,
    private lo: number,
    private gap: number,
  ) {}
  push(h: Hist): Hist | null {
    this.hist.push(h)
    while (this.hist.length && h.t - this.hist[0].t > 2) this.hist.shift()
    if (!this.armed && h.speed < this.lo) this.armed = true
    if (this.armed && h.speed > this.hi && h.t - this.lastRep > this.gap) {
      if (!this.peak || h.speed > this.peak.speed) this.peak = h
    }
    // peak confirmed once the speed falls back
    if (this.peak && h.speed < this.peak.speed * 0.6) {
      const p = this.peak
      this.peak = null
      this.armed = false
      this.lastRep = p.t
      return p
    }
    return null
  }
  window(from: number, to: number) {
    return this.hist.filter((h) => h.t >= from && h.t <= to)
  }
}

function track(t: number, pose: number[], wristIdx: number, prev: Hist | undefined): Hist {
  const wrist = kp(pose, wristIdx)
  const scale = bodyScale(pose)
  const dt = prev ? Math.max(0.016, t - prev.t) : 0.033
  const speed = prev ? Math.hypot(wrist.x - prev.wrist.x, wrist.y - prev.wrist.y) / scale / dt : 0
  // light smoothing
  const s = prev ? prev.speed * 0.4 + speed * 0.6 : speed
  return { t, wrist, speed: s, knee: kneeAngle(pose), scale }
}

export function readyEngine(hand: 'right' | 'left', persona: Persona): DrillEngine {
  const wristIdx = hand === 'right' ? K.rWrist : K.lWrist
  let upTime = 0
  let total = 0
  let stanceGood = 0
  let downSince: number | null = null
  let straightSince: number | null = null
  let last = 0
  let recoveries = 0
  let wasDown = false
  return {
    repLog: [],
    update(t, pose) {
      const dt = last ? Math.min(0.1, t - last) : 0
      last = t
      const { shY, hipY, len } = torso(pose)
      const w = kp(pose, wristIdx)
      const up = w.y < hipY - 0.2 * len && w.y > shY - 0.9 * len
      const knee = kneeAngle(pose)
      const athletic = knee < 168
      total += dt
      if (up) upTime += dt
      if (athletic) stanceGood += dt
      const bad: number[] = []
      let feedback: Feedback | undefined
      if (!up) {
        downSince ??= t
        wasDown = true
        if (t - downSince > 1) {
          bad.push(wristIdx, hand === 'right' ? K.rElbow : K.lElbow)
          feedback = { text: 'Paddle up! In front of your chest.', tone: 'bad', say: persona === 'sarge' ? 'Paddle up! Now!' : 'Paddle up' }
        }
      } else {
        if (wasDown && downSince !== null && t - downSince > 0.4) {
          recoveries++
          feedback = { text: 'Good recovery.', tone: 'good' }
        }
        downSince = null
        wasDown = false
      }
      if (!athletic) {
        straightSince ??= t
        if (t - straightSince > 2) {
          bad.push(K.lKnee, K.rKnee)
          feedback ??= { text: 'Bend your knees. Get athletic.', tone: 'bad', say: 'Knees bent' }
        }
      } else straightSince = null
      const pctUp = total ? (upTime / total) * 100 : 100
      const pctStance = total ? (stanceGood / total) * 100 : 100
      return {
        feedback,
        badJoints: bad,
        reps: recoveries,
        score: Math.round(pctUp * 0.75 + pctStance * 0.25),
        metrics: [
          { label: 'Paddle up', value: `${Math.round(pctUp)}%`, good: pctUp >= 85 },
          { label: 'Knee bend', value: `${Math.round(knee)}°`, good: athletic },
          { label: 'Stance held', value: `${Math.round(pctStance)}%`, good: pctStance >= 80 },
        ],
      }
    },
  }
}

export function dinkEngine(hand: 'right' | 'left', persona: Persona): DrillEngine {
  const wristIdx = hand === 'right' ? K.rWrist : K.lWrist
  const det = new RepDetector(1.4, 0.5, 0.7)
  const log: RepResult[] = []
  let prev: Hist | undefined
  let lastBad: number[] = []
  let badUntil = 0
  let lastMetrics: Metric[] = [
    { label: 'Knee bend', value: '–', good: true },
    { label: 'Swing size', value: '–', good: true },
    { label: 'Contact', value: '–', good: true },
  ]
  return {
    repLog: log,
    update(t, pose) {
      const h = track(t, pose, wristIdx, prev)
      prev = h
      const rep = det.push(h)
      let feedback: Feedback | undefined
      if (rep) {
        const win = det.window(rep.t - 0.7, rep.t)
        const knee = Math.min(...win.map((x) => x.knee))
        const xs = win.map((x) => x.wrist.x)
        const ys = win.map((x) => x.wrist.y)
        const swing = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / rep.scale
        const { hipY, len } = torso(pose)
        const low = rep.wrist.y > hipY - 0.15 * len
        const kneeS = Math.max(0, Math.min(1, (172 - knee) / 25))
        const swingS = Math.max(0, Math.min(1, (1.4 - swing) / 0.7))
        const lowS = low ? 1 : 0.35
        const score = Math.round(100 * (0.4 * kneeS + 0.35 * swingS + 0.25 * lowS))
        const faults: string[] = []
        if (kneeS < 0.6) faults.push('knees')
        if (swingS < 0.6) faults.push('swing')
        if (!low) faults.push('contact')
        log.push({ score, faults })
        lastMetrics = [
          { label: 'Knee bend', value: `${Math.round(knee)}°`, good: kneeS >= 0.6 },
          { label: 'Swing size', value: swing < 0.75 ? 'Compact' : swing < 1.1 ? 'Medium' : 'Too big', good: swingS >= 0.6 },
          { label: 'Contact', value: low ? 'Low, in front' : 'Too high', good: low },
        ]
        if (faults[0] === 'knees') {
          lastBad = [K.lKnee, K.rKnee]
          feedback = { text: 'Bend your knees. Lift with your legs, not your wrist.', tone: 'bad', say: 'Bend your knees' }
        } else if (faults[0] === 'swing') {
          lastBad = [wristIdx, hand === 'right' ? K.rElbow : K.lElbow]
          feedback = { text: 'Shorter swing. Think pendulum from the shoulder.', tone: 'bad', say: 'Shorter swing' }
        } else if (faults[0] === 'contact') {
          lastBad = [wristIdx]
          feedback = { text: 'Let it drop. Contact low and out in front.', tone: 'bad', say: 'Contact lower' }
        } else {
          lastBad = []
          const p = pick(PRAISE[persona])
          feedback = { text: `${p} ${score} form score.`, tone: 'good', say: p }
        }
        badUntil = t + 1.2
      }
      const avg = log.length ? Math.round(log.reduce((a, b) => a + b.score, 0) / log.length) : 0
      return { feedback, badJoints: t < badUntil ? lastBad : [], metrics: lastMetrics, score: avg, reps: log.length }
    },
  }
}

export function serveEngine(hand: 'right' | 'left', persona: Persona): DrillEngine {
  const wristIdx = hand === 'right' ? K.rWrist : K.lWrist
  const det = new RepDetector(1.8, 0.5, 1.5)
  const log: RepResult[] = []
  let prev: Hist | undefined
  let pending: { rep: Hist; legal: boolean; upward: boolean; shY: number } | null = null
  let lastBad: number[] = []
  let badUntil = 0
  let lastMetrics: Metric[] = [
    { label: 'Contact height', value: '–', good: true },
    { label: 'Swing path', value: '–', good: true },
    { label: 'Follow-through', value: '–', good: true },
  ]
  return {
    repLog: log,
    update(t, pose) {
      const h = track(t, pose, wristIdx, prev)
      prev = h
      const rep = det.push(h)
      const { shY, hipY, len } = torso(pose)
      if (rep && !pending) {
        const before = det.window(rep.t - 0.12, rep.t - 0.02)[0]
        const upward = before ? rep.wrist.y < before.wrist.y + 0.002 : true
        pending = { rep, legal: rep.wrist.y > hipY - 0.05 * len, upward, shY }
      }
      let feedback: Feedback | undefined
      if (pending && t - pending.rep.t > 0.55) {
        const after = det.window(pending.rep.t, pending.rep.t + 0.55)
        const follow = after.some((x) => x.wrist.y < pending!.shY + 0.1 * len)
        const score = (pending.legal ? 50 : 0) + (pending.upward ? 25 : 0) + (follow ? 25 : 0)
        const faults: string[] = []
        if (!pending.legal) faults.push('height')
        if (!pending.upward) faults.push('path')
        if (!follow) faults.push('follow')
        log.push({ score, faults })
        lastMetrics = [
          { label: 'Contact height', value: pending.legal ? 'Below waist ✓' : 'Above waist ✗', good: pending.legal },
          { label: 'Swing path', value: pending.upward ? 'Low → high' : 'Flat / down', good: pending.upward },
          { label: 'Follow-through', value: follow ? 'Full' : 'Cut short', good: follow },
        ]
        if (!pending.legal) {
          lastBad = [wristIdx, K.lHip, K.rHip]
          feedback = { text: 'Fault risk: contact must be below your waist.', tone: 'bad', say: 'Contact below the waist' }
        } else if (!pending.upward) {
          lastBad = [wristIdx]
          feedback = { text: 'Swing low to high. Brush up the back of the ball.', tone: 'bad', say: 'Swing low to high' }
        } else if (!follow) {
          lastBad = [wristIdx, hand === 'right' ? K.rShoulder : K.lShoulder]
          feedback = { text: 'Finish high, towards your target.', tone: 'bad', say: 'Finish high' }
        } else {
          lastBad = []
          const p = pick(PRAISE[persona])
          feedback = { text: `${p} Legal, smooth, repeatable.`, tone: 'good', say: p }
        }
        badUntil = t + 1.4
        pending = null
      }
      const avg = log.length ? Math.round(log.reduce((a, b) => a + b.score, 0) / log.length) : 0
      return { feedback, badJoints: t < badUntil ? lastBad : [], metrics: lastMetrics, score: avg, reps: log.length }
    },
  }
}
