import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TopBar } from '../components/ui'
import { listMatches, listSessions, type DrillSession } from '../lib/db'
import type { Match } from '../lib/types'

function Trend({ values, color, label, suffix = '', invert = false }: { values: number[]; color: string; label: string; suffix?: string; invert?: boolean }) {
  const w = 300
  const h = 80
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const X = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w)
  const Y = (v: number) => h - 8 - ((v - min) / span) * (h - 16)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join('')
  const last = values[values.length - 1]
  const delta = values.length > 1 ? last - values[values.length - 2] : 0
  const good = invert ? delta < 0 : delta > 0
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <div className="label">{label}</div>
        {values.length > 1 && delta !== 0 && (
          <div className={`text-xs font-bold ${good ? 'text-lime' : 'text-orange-300'}`}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta))}
            {suffix}
          </div>
        )}
      </div>
      <div className="text-3xl font-black num">
        {Math.round(last)}
        {suffix}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-16 w-full overflow-visible">
        <motion.path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2 }} />
        {values.map((v, i) => (
          <circle key={i} cx={X(i)} cy={Y(v)} r="3.5" fill={color} />
        ))}
      </svg>
    </div>
  )
}

export default function Matches() {
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [sessions, setSessions] = useState<DrillSession[]>([])
  useEffect(() => {
    listMatches().then(setMatches)
    listSessions().then(setSessions)
  }, [])

  if (!matches) return <div className="grid h-[50vh] place-items-center text-mute">Loading…</div>
  const chrono = [...matches].reverse()
  const meStats = chrono
    .map((m) => {
      const me = m.players.find((p) => p.isMe) ?? m.players[0]
      const s = m.stats[me.id]
      return { acc: s.accuracy, ue: s.unforced, kitchen: s.kitchenChances ? (s.kitchenArrivals / s.kitchenChances) * 100 : 0 }
    })
    .slice(-10)

  return (
    <div>
      <TopBar title="Matches & progress" />
      {matches.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-lg font-bold">No matches yet</div>
          <p className="mt-1 text-mute">Analyze your first game to start tracking your progress.</p>
          <Link to="/new" className="btn btn-primary mt-4">
            Analyze a match
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Trend values={meStats.map((s) => s.acc)} color="#d4ff3a" label="Your accuracy" />
            <Trend values={meStats.map((s) => s.ue)} color="#fb923c" label="Unforced errors" invert />
            <Trend values={meStats.map((s) => s.kitchen)} color="#22d3ee" label="Kitchen arrival" suffix="%" />
          </div>
          <h2 className="mb-2 mt-6 text-lg font-extrabold">All matches</h2>
          <div className="space-y-2">
            {matches.map((m, i) => {
              const me = m.players.find((p) => p.isMe) ?? m.players[0]
              const opp = me.team === 0 ? 1 : 0
              const won = m.winner === me.team
              return (
                <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <Link to={`/match/${m.id}`} className="card flex items-center gap-4 p-4 transition hover:border-white/25">
                    <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-sm font-black ${won ? 'bg-lime text-ink' : 'bg-white/8 text-soft'}`}>{won ? 'W' : m.winner === null ? '–' : 'L'}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{m.title}</div>
                      <div className="text-xs text-mute">
                        {new Date(m.createdAt).toLocaleDateString()} · {m.source === 'demo' ? 'Demo' : 'Video'} · {m.rallies.length} rallies
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-black num">
                        {m.finalScore[me.team]}–{m.finalScore[opp]}
                      </div>
                      <div className="text-xs text-mute">acc {m.stats[me.id].accuracy}</div>
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </>
      )}
      {sessions.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-lg font-extrabold">Live Coach sessions</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {sessions.slice(0, 8).map((s) => (
              <div key={s.id} className="card flex items-center justify-between p-3">
                <div>
                  <div className="font-bold capitalize">{s.drill} drill</div>
                  <div className="text-xs text-mute">
                    {new Date(s.at).toLocaleDateString()} · {s.reps} reps · {Math.round(s.seconds)}s
                  </div>
                </div>
                <div className="text-2xl font-black text-lime num">{s.score}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
