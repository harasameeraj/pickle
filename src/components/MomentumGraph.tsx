import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { momentum } from '../lib/momentum'
import type { Match, TeamId } from '../lib/types'
import { GRADE_META } from './ui'

const W = 1000
const H = 240
const PAD = 14

export default function MomentumGraph({ match, team, onSelect, selected }: { match: Match; team: TeamId; onSelect: (rally: number, shot: number) => void; selected?: { rally: number; shot: number } }) {
  const pts = useMemo(() => momentum(match), [match])
  const [hover, setHover] = useState<number | null>(null)
  const n = Math.max(1, pts.length - 1)
  const X = (i: number) => (i / n) * W
  const Y = (wp: number) => PAD + (1 - (team === 0 ? wp : 1 - wp)) * (H - PAD * 2)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.wp).toFixed(1)}`).join('')
  const area = `${line}L${W},${H / 2}L0,${H / 2}Z`
  const markers = pts.filter((p) => p.grade && ['brilliant', 'blunder', 'missed'].includes(p.grade))
  const rallyStarts = pts.filter((p) => p.shot === -1)
  const hp = hover !== null ? pts[hover] : null
  const hr = hp ? match.rallies[hp.rally] : null
  const selIdx = selected ? pts.findIndex((p) => p.rally === selected.rally && p.shot === selected.shot) : -1

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / r.width) * n)
    setHover(Math.max(0, Math.min(pts.length - 1, i)))
  }

  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-48 w-full touch-none md:h-60"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={() => hp && onSelect(hp.rally, Math.max(0, hp.shot))}
      >
        <defs>
          <linearGradient id="mg-up" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={H}>
            <stop offset="0" stopColor="#d4ff3a" stopOpacity="0.6" />
            <stop offset="0.5" stopColor="#d4ff3a" stopOpacity="0.12" />
            <stop offset="0.5" stopColor="#38bdf8" stopOpacity="0.12" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0.6" />
          </linearGradient>
          <clipPath id="mg-reveal">
            <motion.rect x="0" y="0" height={H} initial={{ width: 0 }} animate={{ width: W }} transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }} />
          </clipPath>
        </defs>
        {rallyStarts.map((p) => (
          <line key={p.x} x1={X(p.x)} x2={X(p.x)} y1={0} y2={H} stroke="rgba(255,255,255,.04)" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,.25)" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
        <g clipPath="url(#mg-reveal)">
          <path d={area} fill="url(#mg-up)" />
          <path d={line} fill="none" stroke="#eef6f0" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </g>
        {selIdx >= 0 && <line x1={X(selIdx)} x2={X(selIdx)} y1={0} y2={H} stroke="#d4ff3a" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={0} y2={H} stroke="rgba(255,255,255,.5)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* markers are HTML so they stay round with preserveAspectRatio="none" */}
      <div className="pointer-events-none absolute inset-0">
        {markers.map((p, i) => (
          <motion.span
            key={p.x}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.6 + (i / markers.length) * 1.2, type: 'spring', stiffness: 400, damping: 15 }}
            className="absolute grid h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[6px] font-black text-ink"
            style={{ left: `${(p.x / n) * 100}%`, top: `${(Y(p.wp) / H) * 100}%`, background: GRADE_META[p.grade!].color, boxShadow: `0 0 10px ${GRADE_META[p.grade!].color}` }}
          >
            {GRADE_META[p.grade!].symbol}
          </motion.span>
        ))}
      </div>
      <div className="pointer-events-none absolute left-2 top-1 text-[11px] font-bold text-lime/80">Your team winning</div>
      <div className="pointer-events-none absolute bottom-1 left-2 text-[11px] font-bold text-sky/80">Opponents winning</div>
      {hp && hr && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-48 -translate-x-1/2 rounded-xl border border-line bg-ink/95 p-2.5 text-xs shadow-xl"
          style={{ left: `clamp(100px, ${(hp.x / n) * 100}%, calc(100% - 100px))` }}
        >
          <div className="flex justify-between font-bold">
            <span>Rally {hr.index + 1}</span>
            <span className="num">
              {hr.scoreBefore.points[team]}–{hr.scoreBefore.points[team === 0 ? 1 : 0]}
            </span>
          </div>
          <div className="mt-0.5 text-mute">
            Win chance <b className="text-white num">{Math.round((team === 0 ? hp.wp : 1 - hp.wp) * 100)}%</b>
          </div>
          {hp.grade && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: GRADE_META[hp.grade].color }} />
              <span>
                {match.players.find((p) => p.id === hp.hitter)?.name} · {GRADE_META[hp.grade].label}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
