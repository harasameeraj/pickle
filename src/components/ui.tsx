import { animate, motion, useInView, useMotionValue, useTransform } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { Grade } from '../lib/types'

export const GRADE_META: Record<Grade, { label: string; color: string; symbol: string; blurb: string }> = {
  brilliant: { label: 'Brilliant', color: '#22d3ee', symbol: '!!', blurb: 'A hard shot that turned the rally' },
  great: { label: 'Great', color: '#60a5fa', symbol: '!', blurb: 'The best option under pressure' },
  excellent: { label: 'Excellent', color: '#4ade80', symbol: '★', blurb: 'Near-perfect execution' },
  good: { label: 'Good', color: '#a3e635', symbol: '✓', blurb: 'Solid and safe' },
  inaccuracy: { label: 'Inaccuracy', color: '#facc15', symbol: '?!', blurb: 'Gave the opponent a chance' },
  mistake: { label: 'Mistake', color: '#fb923c', symbol: '?', blurb: 'Put your team in trouble' },
  missed: { label: 'Missed Put-away', color: '#f472b6', symbol: '⊘', blurb: 'A high ball you should have finished' },
  blunder: { label: 'Blunder', color: '#ef4444', symbol: '??', blurb: 'Unforced error — a free point' },
}

export function GradeBadge({ grade, size = 22, pop = false }: { grade: Grade; size?: number; pop?: boolean }) {
  const m = GRADE_META[grade]
  const el = (
    <span
      title={m.label}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-black text-[#07110d] num"
      style={{
        width: size,
        height: size,
        background: m.color,
        fontSize: size * (m.symbol.length > 1 ? 0.42 : 0.55),
        boxShadow: `0 0 ${size * 0.6}px ${m.color}66, inset 0 -2px 0 rgba(0,0,0,.18)`,
      }}
    >
      {m.symbol}
    </span>
  )
  if (!pop) return el
  return (
    <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }} className="inline-flex">
      {el}
    </motion.span>
  )
}

export function CountUp({ to, duration = 1.2, decimals = 0, suffix = '' }: { to: number; duration?: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => v.toFixed(decimals) + suffix)
  useEffect(() => {
    if (!inView) return
    const c = animate(mv, to, { duration, ease: [0.16, 1, 0.3, 1] })
    return c.stop
  }, [inView, to, duration, mv])
  return <motion.span ref={ref} className="num">{text}</motion.span>
}

export function AccuracyRing({ value, size = 84, color = '#d4ff3a', label, sub, delay = 0 }: { value: number; size?: number; color?: string; label?: string; sub?: string; delay?: number }) {
  const r = size / 2 - 7
  const c = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={7} fill="none" />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={7}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            whileInView={{ strokeDashoffset: c * (1 - value / 100) }}
            viewport={{ once: true }}
            transition={{ duration: 1.4, delay, ease: [0.16, 1, 0.3, 1] }}
            style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xl font-black" style={{ fontSize: size * 0.26 }}>
          <CountUp to={value} duration={1.4} />
        </div>
      </div>
      {label && <div className="max-w-[90px] truncate text-sm font-bold">{label}</div>}
      {sub && <div className="-mt-1 text-[11px] text-mute">{sub}</div>}
    </div>
  )
}

export function StatBar({ label, a, b, fmt = (v: number) => `${v}`, colors = ['#d4ff3a', '#38bdf8'] }: { label: string; a: number; b: number; fmt?: (v: number) => string; colors?: [string, string] }) {
  const total = a + b || 1
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-bold num">{fmt(a)}</span>
        <span className="text-mute">{label}</span>
        <span className="font-bold num">{fmt(b)}</span>
      </div>
      <div className="flex h-2 gap-1 overflow-hidden rounded-full">
        <motion.div className="rounded-full" style={{ background: colors[0] }} initial={{ width: 0 }} whileInView={{ width: `${(a / total) * 100}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: 'easeOut' }} />
        <motion.div className="ml-auto rounded-full" style={{ background: colors[1] }} initial={{ width: 0 }} whileInView={{ width: `${(b / total) * 100}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: 'easeOut' }} />
      </div>
    </div>
  )
}

export function Meter({ label, value, max = 100, color = '#d4ff3a', suffix = '%' }: { label: string; value: number; max?: number; color?: string; suffix?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-soft">{label}</span>
        <span className="font-bold num">
          {Math.round(value)}
          {suffix}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} whileInView={{ width: `${Math.min(100, (value / max) * 100)}%` }} viewport={{ once: true }} transition={{ duration: 1.1, ease: 'easeOut' }} />
      </div>
    </div>
  )
}

export function TopBar({ title, back, right }: { title?: ReactNode; back?: boolean | string; right?: ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="sticky top-0 z-30 -mx-4 mb-3 flex h-14 items-center gap-3 bg-ink/80 px-4 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {back && (
        <button onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))} className="grid h-9 w-9 place-items-center rounded-full bg-white/6 text-lg" aria-label="Back">
          ‹
        </button>
      )}
      <div className="min-w-0 flex-1 truncate text-base font-extrabold">{title}</div>
      {right}
    </div>
  )
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2">
      <svg width={small ? 26 : 32} height={small ? 26 : 32} viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="22" fill="#d4ff3a" />
        <g fill="#07110d">
          <circle cx="25" cy="25" r="3" />
          <circle cx="39" cy="25" r="3" />
          <circle cx="32" cy="32" r="3" />
          <circle cx="25" cy="39" r="3" />
          <circle cx="39" cy="39" r="3" />
        </g>
      </svg>
      <span className={`font-black tracking-tight ${small ? 'text-lg' : 'text-xl'}`}>
        Kitchen<span className="text-lime">IQ</span>
      </span>
    </Link>
  )
}

const NAV = [
  { to: '/', label: 'Home', icon: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z' },
  { to: '/matches', label: 'Matches', icon: 'M4 5h16M4 12h16M4 19h10' },
  { to: '/new', label: 'Analyze', icon: '' },
  { to: '/coach', label: 'Coach', icon: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 110 8 4 4 0 010-8z' },
  { to: '/settings', label: 'You', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-8 9c0-4 4-6 8-6s8 2 8 6' },
]

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/85 backdrop-blur-xl safe-bottom md:hidden">
      <div className="mx-auto flex max-w-lg items-end justify-around px-2 pt-2">
        {NAV.map((n) =>
          n.to === '/new' ? (
            <NavLink key={n.to} to={n.to} className="-mt-6 flex flex-col items-center gap-1">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-lime text-ink shadow-[0_10px_30px_-6px_rgba(212,255,58,.7)]">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="text-[10px] font-bold text-lime">{n.label}</span>
            </NavLink>
          ) : (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex w-14 flex-col items-center gap-1 py-1 ${isActive ? 'text-lime' : 'text-mute'}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d={n.icon} />
              </svg>
              <span className="text-[10px] font-semibold">{n.label}</span>
            </NavLink>
          ),
        )}
      </div>
    </nav>
  )
}

export function SideNav() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 border-r border-line p-5 md:flex">
      <div className="mb-6">
        <Logo />
      </div>
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${n.to === '/new' ? 'mb-1 bg-lime text-ink' : isActive ? 'bg-white/8 text-white' : 'text-mute hover:bg-white/5 hover:text-white'}`
          }
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={n.icon || 'M12 5v14M5 12h14'} />
          </svg>
          {n.to === '/new' ? 'Analyze a match' : n.label}
        </NavLink>
      ))}
      <div className="mt-auto text-xs text-mute">Your matches stay on this device.</div>
    </aside>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="relative flex rounded-xl bg-white/5 p-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={`relative z-10 flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${value === o.value ? 'text-ink' : 'text-soft'}`}>
          {value === o.value && <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="absolute inset-0 -z-10 rounded-lg bg-lime" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function useLocalState<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : init
    } catch {
      return init
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* ignore */
    }
  }, [key, v])
  return [v, setV] as const
}

export function Burst({ color = '#22d3ee', count = 18 }: { color?: string; count?: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * Math.PI * 2
        const d = 40 + (i % 3) * 18
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
            style={{ background: color }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(a) * d, y: Math.sin(a) * d, opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        )
      })}
    </div>
  )
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
