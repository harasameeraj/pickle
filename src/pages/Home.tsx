import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GradeBadge, Logo } from '../components/ui'
import { coachReport } from '../lib/coach'
import { listMatches, loadSettings, saveMatch } from '../lib/db'
import { simulateMatch } from '../lib/demo'
import type { Match } from '../lib/types'

export function useDemo() {
  const nav = useNavigate()
  return async (seed?: number) => {
    const s = loadSettings()
    const m = simulateMatch(seed ?? 7, [s.name || 'You', 'Jordan', 'Riley', 'Sam'])
    if (seed) m.id = `demo-${seed}`
    await saveMatch(m)
    nav(`/match/${m.id}`)
  }
}

function HeroCourt() {
  // a tiny animated rally: ball arcs between the two sides while dots shuffle
  return (
    <svg viewBox="0 0 220 260" className="h-full w-full">
      <defs>
        <linearGradient id="hc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f4aa8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#1f4aa8" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <polygon points="70,30 150,30 205,240 15,240" fill="url(#hc)" stroke="#fff" strokeOpacity=".8" strokeWidth="1.5" />
      <polygon points="58,95 162,95 172,131 48,131" fill="#2a63c9" opacity=".7" />
      <polygon points="48,131 172,131 186,180 34,180" fill="#2a63c9" opacity=".7" />
      <line x1="48" y1="131" x2="172" y2="131" stroke="#fff" strokeWidth="3" />
      <line x1="58" y1="95" x2="162" y2="95" stroke="#fff" strokeOpacity=".7" />
      <line x1="34" y1="180" x2="186" y2="180" stroke="#fff" strokeOpacity=".7" />
      <line x1="110" y1="30" x2="110" y2="95" stroke="#fff" strokeOpacity=".6" />
      <line x1="110" y1="180" x2="110" y2="240" stroke="#fff" strokeOpacity=".6" />
      {[
        { x: [80, 88, 80], y: [88, 88, 88], c: '#38bdf8' },
        { x: [140, 132, 140], y: [88, 88, 88], c: '#818cf8' },
        { x: [70, 78, 70], y: [190, 190, 190], c: '#d4ff3a' },
        { x: [150, 140, 150], y: [190, 190, 190], c: '#a3e635' },
      ].map((p, i) => (
        <motion.circle key={i} r="7" fill={p.c} initial={{ cx: p.x[0], cy: p.y[0] }} animate={{ cx: p.x, cy: p.y }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }} />
      ))}
      <motion.circle
        r="4.5"
        fill="#e6ff3d"
        initial={{ cx: 70, cy: 182 }}
        filter="url(#glow)"
        animate={{ cx: [70, 100, 132, 105, 78, 70], cy: [182, 110, 92, 118, 182, 182] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.g animate={{ opacity: [0, 1, 1, 0], y: [6, 0, 0, -6] }} transition={{ duration: 2.4, repeat: Infinity, times: [0.3, 0.38, 0.7, 0.8] }}>
        <rect x="112" y="52" width="74" height="24" rx="12" fill="#22d3ee" />
        <text x="149" y="68" textAnchor="middle" fontSize="11" fontWeight="900" fill="#07110d">
          !! Brilliant
        </text>
      </motion.g>
    </svg>
  )
}

export default function Home() {
  const [matches, setMatches] = useState<Match[] | null>(null)
  const settings = loadSettings()
  const demo = useDemo()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    listMatches().then(setMatches)
  }, [])
  const latest = matches?.[0]
  const me = latest?.players.find((p) => p.isMe) ?? latest?.players[0]
  const report = latest && me ? coachReport(latest, me.id, settings.persona) : null

  return (
    <div className="pt-4">
      <div className="mb-5 flex items-center justify-between md:hidden">
        <Logo small />
        <Link to="/settings" className="chip">
          {settings.name}
        </Link>
      </div>

      <section className="card-hi relative overflow-hidden p-6 md:p-8">
        <div className="relative z-10 max-w-md">
          <div className="chip mb-4 !border-lime/30 !bg-lime/10 !text-lime">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" /> AI pickleball coach
          </div>
          <h1 className="text-[34px] font-black leading-[1.05] tracking-tight md:text-5xl">
            Every shot graded.
            <br />
            <span className="text-lime glow-lime">Every mistake fixed.</span>
          </h1>
          <p className="mt-3 max-w-sm text-soft">
            Film your game. KitchenIQ tracks every player, keeps score, grades every shot from Brilliant to Blunder, and coaches you on the one thing that will win you more points.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/new" className="btn btn-primary">
              Analyze a match
            </Link>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await demo()
              }}
            >
              {busy ? 'Building…' : '▶ Watch a demo review'}
            </button>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-6 -top-2 h-[110%] w-[48%] opacity-40 sm:opacity-90 md:right-6">
          <HeroCourt />
        </div>
      </section>

      {latest && me && report && (
        <section className="mt-6">
          <div className="mb-2 flex items-end justify-between">
            <h2 className="text-lg font-extrabold">Latest match</h2>
            <Link to="/matches" className="text-sm font-semibold text-lime">
              All matches
            </Link>
          </div>
          <Link to={`/match/${latest.id}`} className="card block p-5 transition hover:border-lime/40">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-3xl font-black num">
                  {latest.finalScore[me.team]}
                  <span className="text-mute">–</span>
                  {latest.finalScore[me.team === 0 ? 1 : 0]}
                </div>
                <div className={`text-xs font-bold ${latest.winner === me.team ? 'text-lime' : 'text-orange-400'}`}>{latest.winner === me.team ? 'WIN' : latest.winner === null ? 'UNFINISHED' : 'LOSS'}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{latest.title}</div>
                <div className="text-sm text-mute">
                  Accuracy <b className="text-white">{latest.stats[me.id].accuracy}</b> · {latest.rallies.length} rallies
                </div>
                {report.insights[0] && <div className="mt-1 truncate text-sm text-orange-300">Fix: {report.insights[0].title}</div>}
              </div>
              <div className="flex -space-x-1">
                {(['brilliant', 'great', 'blunder'] as const).map((g) => (
                  <GradeBadge key={g} grade={g} size={26} />
                ))}
              </div>
            </div>
          </Link>
        </section>
      )}

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { to: '/new', t: 'Game Review', d: 'Shot grades, accuracy, momentum, and a 3D replay of every rally.', c: '#d4ff3a', i: '◎' },
          { to: '/coach', t: 'Live Coach', d: 'Camera drills with real-time voice cues on your form.', c: '#22d3ee', i: '◉' },
          { to: '/matches', t: 'Progress', d: 'Track accuracy, errors, and kitchen play match over match.', c: '#818cf8', i: '↗' },
        ].map((c, i) => (
          <motion.div key={c.t} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.07 }}>
            <Link to={c.to} className="card group flex h-full flex-col gap-2 p-5 transition hover:-translate-y-0.5 hover:border-white/20">
              <span className="grid h-10 w-10 place-items-center rounded-xl text-xl font-black text-ink" style={{ background: c.c }}>
                {c.i}
              </span>
              <div className="font-extrabold">{c.t}</div>
              <div className="text-sm text-mute">{c.d}</div>
            </Link>
          </motion.div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-extrabold">How it works</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['1', 'Film from behind the baseline', 'Phone on the fence or a tripod, landscape, the whole court in frame.'],
            ['2', 'Tap the court corners and players', 'Takes 20 seconds. KitchenIQ maps the court and follows each player.'],
            ['3', 'Get your Game Review', 'Score, shot grades, the key moments, and the drill to fix your biggest leak.'],
          ].map(([n, t, d]) => (
            <div key={n} className="card flex gap-3 p-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/8 font-black text-lime">{n}</span>
              <div>
                <div className="font-bold">{t}</div>
                <div className="text-sm text-mute">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
