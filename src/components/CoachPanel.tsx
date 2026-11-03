import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { coachReport, PERSONAS, speak, stopSpeaking, type Persona } from '../lib/coach'
import { loadSettings, saveSettings } from '../lib/db'
import type { Match } from '../lib/types'

function Typewriter({ text }: { text: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    setN(0)
    const id = setInterval(() => setN((v) => (v >= text.length ? v : v + 2)), 18)
    return () => clearInterval(id)
  }, [text])
  return (
    <span>
      {text.slice(0, n)}
      {n < text.length && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-lime align-middle" />}
    </span>
  )
}

export function CoachAvatar({ persona, talking, size = 56 }: { persona: Persona; talking?: boolean; size?: number }) {
  const colors: Record<Persona, string> = { pro: '#22d3ee', hype: '#fb923c', sarge: '#a3e635' }
  return (
    <div className="relative shrink-0" style={{ width: size, height: size, color: colors[persona] }}>
      {talking && <span className="pulse-ring absolute inset-0 rounded-full" />}
      <div className="relative grid h-full w-full place-items-center rounded-full text-2xl" style={{ background: `radial-gradient(circle at 30% 30%, ${colors[persona]}55, #0c1913)`, border: `2px solid ${colors[persona]}` }}>
        {PERSONAS[persona].emoji}
      </div>
    </div>
  )
}

export default function CoachPanel({ match, playerId, onWatch }: { match: Match; playerId: string; onWatch: (rally: number, shot: number) => void }) {
  const [persona, setPersona] = useState<Persona>(loadSettings().persona)
  const [talking, setTalking] = useState(false)
  const report = useMemo(() => coachReport(match, playerId, persona), [match, playerId, persona])
  useEffect(() => () => stopSpeaking(), [])

  const choose = (p: Persona) => {
    stopSpeaking()
    setTalking(false)
    setPersona(p)
    saveSettings({ ...loadSettings(), persona: p })
  }

  const listen = () => {
    if (talking) {
      stopSpeaking()
      setTalking(false)
      return
    }
    setTalking(true)
    speak(report.speech, persona, () => setTalking(false))
  }

  const keyShotOf = (rally?: number) => (rally === undefined ? null : { rally, shot: match.rallies[rally]?.keyShot ?? 0 })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(PERSONAS) as Persona[]).map((p) => (
          <button key={p} onClick={() => choose(p)} className={`card flex flex-col items-center gap-1.5 p-3 text-center transition ${persona === p ? '!border-lime/60 !bg-lime/10' : 'opacity-70 hover:opacity-100'}`}>
            <CoachAvatar persona={p} size={42} />
            <div className="text-sm font-bold">{PERSONAS[p].name}</div>
            <div className="hidden text-[11px] text-mute sm:block">{PERSONAS[p].tag}</div>
          </button>
        ))}
      </div>

      <div className="card-hi p-5">
        <div className="flex items-start gap-4">
          <CoachAvatar persona={persona} talking={talking} />
          <div className="min-w-0 flex-1">
            <div className="label">{PERSONAS[persona].name} · {report.headline}</div>
            <p className="mt-1 text-lg font-semibold leading-snug">
              <Typewriter text={report.intro} />
            </p>
          </div>
        </div>
        <button onClick={listen} className="btn btn-primary mt-4 w-full sm:w-auto">
          {talking ? '■ Stop' : '🔊 Hear the full breakdown'}
        </button>
      </div>

      {report.strength && (
        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="card border-l-4 !border-l-lime p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="label !text-lime">What went well</div>
              <div className="font-extrabold">{report.strength.title}</div>
              <div className="text-sm text-soft">{report.strength.body}</div>
            </div>
            <div className="chip shrink-0 !bg-lime/10 !text-lime">{report.strength.stat}</div>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {report.insights.map((ins, i) => {
          const k = keyShotOf(ins.rally)
          return (
            <motion.div key={ins.title + persona} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }} className="card border-l-4 !border-l-orange-400 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="label !text-orange-300">Leak #{i + 1}</div>
                  <div className="font-extrabold">{ins.title}</div>
                  <div className="text-sm text-soft">{ins.body}</div>
                </div>
                <div className="chip shrink-0 !bg-orange-400/10 !text-orange-300">{ins.stat}</div>
              </div>
              {k && (
                <button onClick={() => onWatch(k.rally, k.shot)} className="mt-3 text-sm font-bold text-lime">
                  ▶ Watch it happen (rally {k.rally + 1})
                </button>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>

      <div className="card p-5">
        <div className="label">This week’s fix</div>
        <div className="mt-1 text-xl font-black">{report.fix.title}</div>
        <div className="mb-4 text-sm text-soft">{report.fix.why}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          {report.fix.drills.map((d, i) => (
            <div key={d.id} className="flex flex-col rounded-2xl border border-line bg-white/3 p-4">
              <div className="flex items-center justify-between">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-lime text-sm font-black text-ink">{i + 1}</span>
                <span className="text-xs text-mute">{d.minutes} min</span>
              </div>
              <div className="mt-2 font-bold">{d.name}</div>
              <div className="mt-1 flex-1 text-sm text-mute">{d.how}</div>
              <div className="mt-2 text-xs font-semibold text-soft">Goal: {d.goal}</div>
              {d.live && (
                <Link to={`/live/${d.live}`} className="btn btn-ghost mt-3 !py-2 text-sm">
                  ◉ Train with Live Coach
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
