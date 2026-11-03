import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { CoachAvatar } from '../components/CoachPanel'
import { TopBar } from '../components/ui'
import { DRILLS, PERSONAS } from '../lib/coach'
import { loadSettings } from '../lib/db'

export const LIVE_DRILLS = [
  { id: 'ready', name: 'Paddle Up', tag: 'Ready position', desc: 'Stay in an athletic ready position with the paddle in front of your chest. The coach calls you out the moment it drops.', color: '#d4ff3a', icon: '🛡' },
  { id: 'dink', name: 'Dink Form', tag: 'Knees · swing · contact', desc: 'Shadow or live dinks. Every rep is scored on knee bend, compact swing and low contact.', color: '#22d3ee', icon: '🎯' },
  { id: 'serve', name: 'Serve Check', tag: 'Legal & repeatable', desc: 'Checks contact below the waist and a low-to-high swing on every serve, so you never hear “fault”.', color: '#fb923c', icon: '🚀' },
] as const

export default function Coach() {
  const persona = loadSettings().persona
  return (
    <div>
      <TopBar title="Live Coach" />
      <div className="card-hi mb-4 flex items-center gap-4 p-5">
        <CoachAvatar persona={persona} size={56} />
        <div>
          <div className="font-extrabold">{PERSONAS[persona].name} is ready</div>
          <div className="text-sm text-soft">Prop your phone up 2–3 m away so your whole body is in frame. Turn the volume up: cues are spoken out loud.</div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {LIVE_DRILLS.map((d, i) => (
          <motion.div key={d.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
            <Link to={`/live/${d.id}`} className="card group flex h-full flex-col p-5 transition hover:-translate-y-0.5 hover:border-white/25">
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl text-2xl" style={{ background: `${d.color}22`, border: `1px solid ${d.color}55` }}>
                {d.icon}
              </div>
              <div className="label" style={{ color: d.color }}>
                {d.tag}
              </div>
              <div className="text-xl font-black">{d.name}</div>
              <div className="mt-1 flex-1 text-sm text-mute">{d.desc}</div>
              <div className="mt-4 font-bold" style={{ color: d.color }}>
                Start drill →
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
      <h2 className="mb-2 mt-8 text-lg font-extrabold">Court drills library</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.values(DRILLS).map((d) => (
          <div key={d.id} className="card p-4">
            <div className="flex items-center justify-between">
              <div className="font-bold">{d.name}</div>
              <span className="chip">{d.minutes} min</span>
            </div>
            <div className="mt-1 text-sm text-mute">{d.how}</div>
            <div className="mt-2 text-xs font-semibold text-soft">Goal: {d.goal}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
