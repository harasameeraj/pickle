import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SHOT_LABEL } from '../lib/analyze'
import { rallyEnd } from '../lib/ballpath'
import { sampleIndex } from '../lib/track'
import type { Match, Rally, Shot } from '../lib/types'
import { BONES, kp, K } from '../lib/vision'
import { ReplayScene, type View } from './replay3d'
import { Burst, GRADE_META, GradeBadge } from './ui'

const VIEWS: { v: View; label: string }[] = [
  { v: 'broadcast', label: 'TV' },
  { v: 'baseline', label: 'Player' },
  { v: 'side', label: 'Side' },
  { v: 'top', label: 'Top' },
]

export default function RallyPlayer({
  match,
  rally,
  shotIdx,
  onShot,
  videoUrl,
  sceneRef,
}: {
  match: Match
  rally: Rally
  shotIdx: number
  onShot: (i: number) => void
  videoUrl?: string
  sceneRef?: React.MutableRefObject<ReplayScene | null>
}) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<ReplayScene | null>(null)
  const [mode, setMode] = useState<'3d' | 'video'>(videoUrl ? 'video' : '3d')
  const [view, setView] = useState<View>('broadcast')
  const [time, setTime] = useState(rally.start)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(0.6)
  const [ghost, setGhost] = useState(false)
  const [live, setLive] = useState<Shot | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const end = useMemo(() => rallyEnd(rally), [rally])
  const start = rally.shots[0] ? rally.shots[0].t - 0.8 : rally.start
  const shot = rally.shots[shotIdx]
  const name = (id: string) => match.players.find((p) => p.id === id)?.name ?? '?'

  // 3D scene lifetime
  useEffect(() => {
    if (mode !== '3d' || !host.current) return
    const s = new ReplayScene(host.current, match.players)
    scene.current = s
    if (sceneRef) sceneRef.current = s
    let last = 0
    s.onTime = (t) => {
      const now = performance.now()
      if (now - last > 60) {
        last = now
        setTime(t)
      }
    }
    s.onShot = (sh) => setLive(sh)
    s.onEnd = () => setPlaying(false)
    return () => {
      s.dispose()
      scene.current = null
      if (sceneRef) sceneRef.current = null
    }
  }, [mode, match, sceneRef])

  // load rally
  useEffect(() => {
    setGhost(false)
    setLive(null)
    if (mode === '3d' && scene.current) {
      scene.current.setRally(rally)
      scene.current.setView(view)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rally, mode])

  // jump to the selected shot and play through it
  useEffect(() => {
    if (!shot) return
    setGhost(false)
    const next = rally.shots[shotIdx + 1]
    const from = Math.max(start, shot.t - 0.7)
    const to = next ? next.t + 0.05 : end
    if (mode === '3d' && scene.current) {
      const s = scene.current
      s.clearGhost()
      s.seek(from)
      s.speed = speed
      s.stopAt = to
      s.playing = true
      setPlaying(true)
    } else if (mode === 'video' && video.current) {
      const v = video.current
      v.currentTime = from
      v.playbackRate = speed
      stopAtRef.current = to
      v.play().catch(() => {})
      setPlaying(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotIdx, rally, mode])

  useEffect(() => {
    if (scene.current) scene.current.speed = speed
    if (video.current) video.current.playbackRate = speed
  }, [speed])

  // video overlay: skeletons, ball trail and grade pop-ups
  const stopAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (mode !== 'video') return
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const v = video.current
      const c = overlay.current
      if (!v || !c) return
      const t = v.currentTime
      if (stopAtRef.current !== null && t >= stopAtRef.current) {
        v.pause()
        stopAtRef.current = null
        setPlaying(false)
      }
      setTime(t)
      const cur = [...rally.shots].reverse().find((s) => s.t <= t + 0.02)
      setLive((prev) => (cur && prev?.index !== cur.index && t - cur.t < 0.4 ? cur : prev))
      const rect = c.getBoundingClientRect()
      const dpr = Math.min(2, devicePixelRatio)
      if (c.width !== rect.width * dpr) {
        c.width = rect.width * dpr
        c.height = rect.height * dpr
      }
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)
      const ar = v.videoWidth / v.videoHeight || 16 / 9
      let w = rect.width
      let h = w / ar
      if (h > rect.height) {
        h = rect.height
        w = h * ar
      }
      const ox = (rect.width - w) / 2
      const oy = (rect.height - h) / 2
      const P = (x: number, y: number) => [ox + x * w, oy + y * h] as const
      const tr = rally.track
      if (!tr.length) return
      const i = sampleIndex(tr, t)
      const sm = tr[i]
      for (const p of match.players) {
        const pose = sm.pose?.[p.id]
        if (!pose) continue
        const hitting = rally.shots.find((s) => s.hitter === p.id && Math.abs(s.t - t) < 0.5)
        ctx.strokeStyle = p.color
        ctx.lineWidth = hitting ? 4 : 2.5
        ctx.shadowColor = p.color
        ctx.shadowBlur = hitting ? 14 : 6
        ctx.lineCap = 'round'
        for (const [a, b] of BONES) {
          const A = P(pose[a * 2], pose[a * 2 + 1])
          const B = P(pose[b * 2], pose[b * 2 + 1])
          ctx.beginPath()
          ctx.moveTo(A[0], A[1])
          ctx.lineTo(B[0], B[1])
          ctx.stroke()
        }
        ctx.shadowBlur = 0
        const head = kp(pose, K.nose)
        const [hx, hy] = P(head.x, head.y)
        ctx.font = '700 12px Inter, sans-serif'
        const tw = ctx.measureText(p.name).width + 14
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.roundRect(hx - tw / 2, hy - 34, tw, 20, 10)
        ctx.fill()
        ctx.fillStyle = '#07110d'
        ctx.textAlign = 'center'
        ctx.fillText(p.name, hx, hy - 20)
        if (hitting && t >= hitting.t) {
          const m = GRADE_META[hitting.grade]
          const age = t - hitting.t
          const r = 13 * Math.min(1, age / 0.12)
          ctx.fillStyle = m.color
          ctx.shadowColor = m.color
          ctx.shadowBlur = 18
          ctx.beginPath()
          ctx.arc(hx, hy - 52, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
          ctx.fillStyle = '#07110d'
          ctx.font = '900 12px Inter, sans-serif'
          ctx.fillText(m.symbol, hx, hy - 48)
        }
      }
      // ball trail
      ctx.lineWidth = 3
      for (let k = Math.max(0, i - 8); k < i; k++) {
        const a = tr[k].ball
        const b = tr[k + 1].ball
        if (!a || !b) continue
        ctx.strokeStyle = `rgba(230,255,61,${(k - i + 9) / 9})`
        const A = P(a.x, a.y)
        const B = P(b.x, b.y)
        ctx.beginPath()
        ctx.moveTo(A[0], A[1])
        ctx.lineTo(B[0], B[1])
        ctx.stroke()
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [mode, rally, match])

  const togglePlay = () => {
    if (mode === '3d' && scene.current) {
      const s = scene.current
      if (s.playing) {
        s.playing = false
        setPlaying(false)
      } else {
        if (s.time >= end - 0.05) s.seek(start)
        s.stopAt = null
        s.playing = true
        setPlaying(true)
      }
    } else if (video.current) {
      const v = video.current
      if (!v.paused) {
        v.pause()
        setPlaying(false)
      } else {
        if (v.currentTime >= end - 0.05 || v.currentTime < start - 1) v.currentTime = start
        stopAtRef.current = end
        v.play().catch(() => {})
        setPlaying(true)
      }
    }
  }

  const scrub = (t: number) => {
    if (mode === '3d' && scene.current) {
      scene.current.playing = false
      scene.current.seek(t)
    } else if (video.current) {
      video.current.pause()
      video.current.currentTime = t
    }
    setPlaying(false)
    setTime(t)
  }

  const showBetter = () => {
    if (!shot?.better) return
    if (ghost) {
      scene.current?.clearGhost()
      setGhost(false)
      return
    }
    if (mode !== '3d') setMode('3d')
    setTimeout(() => {
      const s = scene.current
      if (!s) return
      s.playing = false
      s.seek(shot.t + 0.05)
      s.showGhost(shot, shot.better!)
      s.setView('side')
      setView('side')
      setPlaying(false)
      setGhost(true)
    }, mode === '3d' ? 0 : 120)
  }

  const pct = (t: number) => ((t - start) / (end - start)) * 100

  return (
    <div className="card overflow-hidden">
      <div className="relative aspect-[4/3] w-full bg-black sm:aspect-[16/9]">
        {mode === '3d' ? (
          <div ref={host} className="absolute inset-0" />
        ) : (
          <>
            <video ref={video} src={videoUrl} playsInline muted={false} className="absolute inset-0 h-full w-full object-contain" onPause={() => setPlaying(false)} />
            <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" />
          </>
        )}

        {/* top controls */}
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-2.5">
          {videoUrl && (
            <div className="flex rounded-lg bg-black/50 p-0.5 text-xs font-bold backdrop-blur">
              {(['video', '3d'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 ${mode === m ? 'bg-lime text-ink' : 'text-white/80'}`}>
                  {m === '3d' ? '3D' : 'Video'}
                </button>
              ))}
            </div>
          )}
          <div className="chip !border-white/10 !bg-black/50 backdrop-blur">
            Rally {rally.index + 1} · {rally.scoreBefore.points[0]}–{rally.scoreBefore.points[1]}
          </div>
          {mode === '3d' && (
            <div className="ml-auto flex rounded-lg bg-black/50 p-0.5 text-xs font-bold backdrop-blur">
              {VIEWS.map((x) => (
                <button
                  key={x.v}
                  onClick={() => {
                    setView(x.v)
                    scene.current?.setView(x.v)
                  }}
                  className={`rounded-md px-2 py-1 ${view === x.v ? 'bg-white/90 text-ink' : 'text-white/75'}`}
                >
                  {x.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* live caption */}
        <AnimatePresence mode="popLayout">
          {live && !ghost && (
            <motion.div
              key={`${rally.index}-${live.index}`}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/65 p-2.5 pr-3 backdrop-blur-md sm:right-auto sm:max-w-md"
            >
              <div className="relative">
                <GradeBadge grade={live.grade} size={34} pop />
                {live.grade === 'brilliant' && <Burst color={GRADE_META.brilliant.color} />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-extrabold">
                  <span>{name(live.hitter)}</span>
                  <span className="text-white/50">·</span>
                  <span>{SHOT_LABEL[live.type]}</span>
                  <span className="font-bold" style={{ color: GRADE_META[live.grade].color }}>
                    {GRADE_META[live.grade].label}
                  </span>
                </div>
                <div className="truncate text-xs text-white/75">{live.note}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {ghost && shot?.better && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="absolute bottom-3 left-3 right-3 rounded-2xl border border-cyan-300/40 bg-cyan-950/80 p-3 text-sm backdrop-blur sm:right-auto sm:max-w-sm">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold">
              <span className="h-0.5 w-5 bg-cyan-300" /> Better shot
              <span className="ml-2 h-0.5 w-5 border-t-2 border-dashed border-red-400" /> What happened
            </div>
            <div className="font-bold text-cyan-100">{SHOT_LABEL[shot.better.type]}</div>
            <div className="text-cyan-100/80">{shot.better.tip}</div>
          </motion.div>
        )}
      </div>

      {/* transport */}
      <div className="space-y-2 p-3">
        <div className="relative h-7">
          <div className="absolute inset-x-0 top-3 h-1.5 rounded-full bg-white/10" />
          <div className="absolute left-0 top-3 h-1.5 rounded-full bg-lime" style={{ width: `${Math.max(0, Math.min(100, pct(time)))}%` }} />
          {rally.shots.map((s) => (
            <button
              key={s.index}
              onClick={() => onShot(s.index)}
              className="absolute top-1.5 h-4.5 w-2 -translate-x-1/2 rounded-sm"
              style={{ left: `${pct(s.t)}%`, background: GRADE_META[s.grade].color, outline: s.index === shotIdx ? '2px solid white' : undefined, height: 18 }}
              aria-label={`Shot ${s.index + 1}`}
            />
          ))}
          <input type="range" min={start} max={end} step={0.01} value={time} onChange={(e) => scrub(+e.target.value)} className="absolute inset-0 w-full cursor-pointer opacity-0" aria-label="Scrub rally" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onShot(Math.max(0, shotIdx - 1))} className="btn btn-ghost !h-10 !w-10 !p-0" aria-label="Previous shot">
            ‹
          </button>
          <button onClick={togglePlay} className="btn btn-primary !h-10 !px-4">
            {playing ? '❚❚' : '▶'}
          </button>
          <button onClick={() => onShot(Math.min(rally.shots.length - 1, shotIdx + 1))} className="btn btn-ghost !h-10 !w-10 !p-0" aria-label="Next shot">
            ›
          </button>
          <div className="flex rounded-lg bg-white/5 p-0.5 text-xs font-bold">
            {[0.25, 0.6, 1].map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className={`rounded-md px-2 py-1.5 ${speed === s ? 'bg-white/90 text-ink' : 'text-soft'}`}>
                {s}x
              </button>
            ))}
          </div>
          {shot?.better && (
            <button onClick={showBetter} className={`btn ml-auto !px-3 !py-2 text-sm ${ghost ? 'bg-cyan-300 text-ink' : 'border border-cyan-300/40 bg-cyan-300/10 text-cyan-200'}`}>
              {ghost ? 'Hide' : '✦ Show better shot'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
