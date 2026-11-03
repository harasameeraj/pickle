import { SHOT_LABEL } from './analyze'
import { netDist } from './court'
import { posAt } from './track'
import type { Match, Player, ShotType } from './types'

export type Persona = 'pro' | 'hype' | 'sarge'

export const PERSONAS: Record<Persona, { name: string; tag: string; emoji: string; rate: number; pitch: number }> = {
  pro: { name: 'Coach Maya', tag: 'Calm and technical', emoji: '🎯', rate: 1, pitch: 1 },
  hype: { name: 'Coach Blaze', tag: 'High energy hype', emoji: '🔥', rate: 1.08, pitch: 1.15 },
  sarge: { name: 'Sarge', tag: 'Blunt drill sergeant', emoji: '🪖', rate: 1.02, pitch: 0.85 },
}

export type LiveDrillId = 'ready' | 'dink' | 'serve'

export interface Drill {
  id: string
  name: string
  minutes: number
  how: string
  goal: string
  live?: LiveDrillId
}

export const DRILLS: Record<string, Drill> = {
  returnRun: {
    id: 'returnRun',
    name: 'Return & Run',
    minutes: 10,
    how: 'Partner serves 20 balls. Hit a deep return, then sprint and split-step at the kitchen line before their third shot bounces.',
    goal: 'Be set at the line on 16 of 20 returns.',
  },
  patience: {
    id: 'patience',
    name: 'Patience Dinks',
    minutes: 8,
    how: 'Cross-court dink rally. You may only attack a ball you contact above the net. Anything lower goes back as a dink.',
    goal: '3 rallies of 25+ dinks with zero low speed-ups.',
    live: 'dink',
  },
  dinkForm: {
    id: 'dinkForm',
    name: 'Knees, Not Wrist',
    minutes: 6,
    how: 'Use Live Coach dink mode. Every dink: bend your knees, short pendulum swing, finish with the paddle low and pointing at the target.',
    goal: 'Average form score above 80.',
    live: 'dink',
  },
  dropLadder: {
    id: 'dropLadder',
    name: 'Drop Ladder',
    minutes: 10,
    how: 'From the baseline, hit 10 drops. Each one that lands in the kitchen lets you take one step forward. A pop-up sends you back to the baseline.',
    goal: 'Reach the kitchen line within 12 drops.',
  },
  putaway: {
    id: 'putaway',
    name: 'High Ball, Finish It',
    minutes: 6,
    how: 'Partner feeds random dinks with every 4th one high. Recognise the high ball early and put it away at their feet.',
    goal: 'Finish 8 of 10 high balls.',
  },
  ready: {
    id: 'ready',
    name: 'Paddle Up',
    minutes: 5,
    how: 'Live Coach ready mode: hold the paddle in front of your chest between every shot and recover after each swing.',
    goal: 'Stay paddle-up 90% of the time.',
    live: 'ready',
  },
  serve: {
    id: 'serve',
    name: 'Deep Serve Targets',
    minutes: 6,
    how: 'Put a towel 3 ft inside the baseline. 20 serves with a low-to-high swing and contact below the waist.',
    goal: '18 of 20 in, 10 landing past the towel.',
    live: 'serve',
  },
  stackSync: {
    id: 'stackSync',
    name: 'Move Like a String',
    minutes: 8,
    how: 'With your partner, imagine a 10 ft rope between you. Shadow drill: when one moves forward or sideways, the other mirrors.',
    goal: 'No "one up, one back" moments in a 10-minute game.',
  },
}

export interface Insight {
  title: string
  body: string
  stat: string
  tone: 'bad' | 'good'
  rally?: number
  weight: number
}

export interface CoachReport {
  persona: Persona
  player: Player
  headline: string
  intro: string
  insights: Insight[]
  strength: Insight | null
  fix: { title: string; why: string; drills: Drill[] }
  closing: string
  speech: string
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

function voice(persona: Persona) {
  return {
    won: {
      pro: 'Good win. Let’s make sure it repeats.',
      hype: 'LET’S GO! That’s a W!',
      sarge: 'You won. Don’t get comfortable.',
    }[persona],
    lost: {
      pro: 'Close one. The fix is clear and very doable.',
      hype: 'Tough one, but we’re about to level up big time.',
      sarge: 'You lost. Here’s exactly why. Listen up.',
    }[persona],
    bridge: {
      pro: 'Here is what the film says.',
      hype: 'I watched every single shot. Here’s the tape!',
      sarge: 'I watched the tape. It wasn’t pretty.',
    }[persona],
    fixLead: {
      pro: 'If you change one thing this week, make it this:',
      hype: 'Your ONE mission this week:',
      sarge: 'Your orders for this week:',
    }[persona],
    close: {
      pro: 'Do the drills, play again, and we’ll measure the change.',
      hype: 'Get those reps in and next match we’re cooking!',
      sarge: 'Drills. Then a rematch. No excuses.',
    }[persona],
  }
}

export function coachReport(m: Match, playerId: string, persona: Persona): CoachReport {
  const player = m.players.find((p) => p.id === playerId)!
  const st = m.stats[playerId]
  const ts = m.teamStats[player.team]
  const v = voice(persona)
  const won = m.winner === player.team
  const insights: Insight[] = []
  const strengths: Insight[] = []

  // Kitchen arrival and what it cost
  let stayN = 0,
    stayW = 0,
    inN = 0,
    inW = 0,
    stayRally: number | undefined
  for (const r of m.rallies) {
    const k = r.shots.findIndex((s) => s.hitter === playerId && (s.index === 1 || (s.index === 2 && (s.type === 'drop' || s.type === 'drive'))))
    if (k < 0 || r.shots.length <= k + 1) continue
    const tCheck = r.shots[k + 2]?.t ?? r.shots[k].t + 2.6
    const pos = posAt(r.track, playerId, tCheck)
    const arrived = pos && netDist(pos) <= 10
    const w = r.winner === player.team
    if (arrived) {
      inN++
      if (w) inW++
    } else {
      stayN++
      if (w) stayW++
      if (!w && stayRally === undefined) stayRally = r.index
    }
  }
  const arrival = pct(st.kitchenArrivals, st.kitchenChances)
  if (st.kitchenChances >= 4 && arrival < 75)
    insights.push({
      title: 'You’re stuck in no-man’s land',
      body: `You got to the kitchen line in ${st.kitchenArrivals} of ${st.kitchenChances} chances. When you got there you won ${pct(inW, inN)}% of rallies; when you stayed back, ${pct(stayW, stayN)}%.`,
      stat: `${arrival}% kitchen arrival`,
      tone: 'bad',
      rally: stayRally,
      weight: (75 - arrival) * 1.4 + 10,
    })
  else if (st.kitchenChances >= 4)
    strengths.push({ title: 'Owns the kitchen line', body: `Reached the line ${arrival}% of the time after returns and third shots.`, stat: `${arrival}% arrival`, tone: 'good', weight: arrival })

  // Low speed-ups
  let lowSU = 0,
    lowSULost = 0,
    lowRally: number | undefined
  for (const r of m.rallies)
    for (const s of r.shots)
      if (s.hitter === playerId && s.type === 'speedup' && s.contact === 'low') {
        lowSU++
        if (r.winner !== player.team) {
          lowSULost++
          if (lowRally === undefined) lowRally = r.index
        }
      }
  if (lowSU >= 2)
    insights.push({
      title: 'Speeding up from below the net',
      body: `You sped up ${lowSU} balls you contacted below the net and lost ${lowSULost} of those rallies. They had time to counter every time.`,
      stat: `${lowSULost}/${lowSU} lost`,
      tone: 'bad',
      rally: lowRally,
      weight: lowSULost * 9 + 8,
    })

  if (st.missedPutaways >= 1) {
    const r = m.rallies.find((r) => r.shots.some((s) => s.hitter === playerId && s.grade === 'missed'))
    insights.push({
      title: 'Missed put-aways',
      body: `${st.missedPutaways} times the ball was above your shoulder at the kitchen and you dinked it back. Those are free points.`,
      stat: `${st.missedPutaways} missed`,
      tone: 'bad',
      rally: r?.index,
      weight: st.missedPutaways * 11,
    })
  }

  // Unforced errors by shot
  const ueByType: Partial<Record<ShotType, number>> = {}
  let ueRally: number | undefined
  for (const r of m.rallies) {
    const last = r.shots[r.shots.length - 1]
    if (last.hitter === playerId && last.outcome === 'unforced') {
      ueByType[last.type] = (ueByType[last.type] ?? 0) + 1
      if (ueRally === undefined) ueRally = r.index
    }
  }
  const worstUE = Object.entries(ueByType).sort((a, b) => b[1] - a[1])[0]
  if (st.unforced >= 3 && worstUE)
    insights.push({
      title: `${st.unforced} unforced errors`,
      body: `Your most common: ${SHOT_LABEL[worstUE[0] as ShotType].toLowerCase()} (${worstUE[1]}). Every one is a point you gave away without being pressured.`,
      stat: `${st.unforced} UE`,
      tone: 'bad',
      rally: ueRally,
      weight: st.unforced * 5,
    })

  if (st.dropsTotal >= 3) {
    const r = pct(st.dropsGood, st.dropsTotal)
    if (r < 60)
      insights.push({ title: 'Third-shot drops are floating', body: `Only ${st.dropsGood} of ${st.dropsTotal} third-shot drops stayed unattackable.`, stat: `${r}% good drops`, tone: 'bad', weight: (60 - r) * 0.8 + 6 })
    else strengths.push({ title: 'Reliable third-shot drop', body: `${st.dropsGood} of ${st.dropsTotal} drops kept the opponents hitting up.`, stat: `${r}% good drops`, tone: 'good', weight: r })
  }

  if (ts.splitPct >= 15)
    insights.push({
      title: 'One up, one back',
      body: `Your team was split, with one player at the line and one deep, ${ts.splitPct}% of the time. That leaves a hole down the middle and at the feet of the back player.`,
      stat: `${ts.splitPct}% split`,
      tone: 'bad',
      weight: ts.splitPct * 0.7,
    })

  if (st.dinks >= 10) {
    const err = pct(st.dinkErrors, st.dinks)
    if (err <= 6) strengths.push({ title: 'Patient dinker', body: `${st.dinks} dinks with only ${st.dinkErrors} errors.`, stat: `${100 - err}% dink consistency`, tone: 'good', weight: 100 - err })
    else insights.push({ title: 'Dinks finding the net', body: `${st.dinkErrors} of your ${st.dinks} dinks were errors.`, stat: `${err}% dink errors`, tone: 'bad', weight: err * 1.5 })
  }
  if (st.serveTotal >= 4 && st.serveIn === st.serveTotal)
    strengths.push({ title: 'Never missed a serve', body: `${st.serveTotal} for ${st.serveTotal}. No free points.`, stat: '100% serves in', tone: 'good', weight: 90 })
  if (st.winners >= 3)
    strengths.push({ title: 'Finisher', body: `${st.winners} outright winners.`, stat: `${st.winners} winners`, tone: 'good', weight: 60 + st.winners })

  insights.sort((a, b) => b.weight - a.weight)
  strengths.sort((a, b) => b.weight - a.weight)
  const top = insights.slice(0, 3)
  const main = top[0]

  const drills: Drill[] = []
  const add = (id: string) => DRILLS[id] && !drills.includes(DRILLS[id]) && drills.push(DRILLS[id])
  for (const i of top) {
    if (i.title.includes('no-man')) add('returnRun')
    if (i.title.includes('below the net')) add('patience')
    if (i.title.includes('put-away')) add('putaway')
    if (i.title.includes('drops')) add('dropLadder')
    if (i.title.includes('Dinks')) add('dinkForm')
    if (i.title.includes('One up')) add('stackSync')
    if (i.title.includes('unforced') && worstUE?.[0] === 'serve') add('serve')
    if (i.title.includes('unforced') && worstUE?.[0] === 'dink') add('dinkForm')
  }
  add('ready')
  if (drills.length < 3) add('dinkForm')

  const fixTitle = main ? main.title : 'Keep the paddle up'
  const fixWhy = main ? main.body : 'Your game was clean. The next level comes from faster hands at the line.'
  const headline = won
    ? `${m.finalScore[player.team]}–${m.finalScore[player.team === 0 ? 1 : 0]} win · ${st.accuracy} accuracy`
    : `${m.finalScore[player.team]}–${m.finalScore[player.team === 0 ? 1 : 0]} loss · ${st.accuracy} accuracy`
  const intro = `${won ? v.won : v.lost} ${v.bridge}`
  const strength = strengths[0] ?? null
  const closing = v.close
  const speech = [
    intro,
    `${player.name === 'You' ? 'Your' : player.name + "'s"} accuracy was ${st.accuracy}.`,
    strength ? `What went well: ${strength.title}. ${strength.body}` : '',
    ...top.map((i) => `${i.title}. ${i.body}`),
    `${v.fixLead} ${fixTitle}. Start with the ${drills[0].name} drill.`,
    closing,
  ]
    .filter(Boolean)
    .join(' ')

  return { persona, player, headline, intro, insights: top, strength, fix: { title: fixTitle, why: fixWhy, drills: drills.slice(0, 3) }, closing, speech }
}

// ---------- Text to speech ----------

let speaking = false
export function speak(text: string, persona: Persona = 'pro', onEnd?: () => void) {
  if (!('speechSynthesis' in window)) return onEnd?.()
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const p = PERSONAS[persona]
  u.rate = p.rate
  u.pitch = p.pitch
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
  const pick = voices.find((v) => /Samantha|Google US English|Aria|Jenny|Daniel/i.test(v.name)) ?? voices[0]
  if (pick) u.voice = pick
  speaking = true
  u.onend = () => {
    speaking = false
    onEnd?.()
  }
  window.speechSynthesis.speak(u)
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  speaking = false
}

export const isSpeaking = () => speaking

/** Short cue, never interrupts a cue already playing. */
export function cue(text: string, persona: Persona = 'pro') {
  if (!('speechSynthesis' in window)) return
  if (window.speechSynthesis.speaking) return
  const u = new SpeechSynthesisUtterance(text)
  u.rate = PERSONAS[persona].rate * 1.1
  u.pitch = PERSONAS[persona].pitch
  window.speechSynthesis.speak(u)
}
