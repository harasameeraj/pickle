import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { TopBar } from '../components/ui'
import { flow } from '../lib/flow'
import { detectRallies, extract, type Progress } from '../lib/pipeline'
import { BONES } from '../lib/vision'

const STAGES = ['Listening for paddle pops', 'Loading the AI vision model', 'Tracking players and ball', 'Finding rallies']

export default function Analyzing() {
  const nav = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [p, setP] = useState<Progress>({ phase: 'Getting ready', pct: 0 })
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!flow.file || !flow.corners || !flow.seeds) return
    const v = video.current!
    const ac = new AbortController()
    abort.current = ac
    let lock: { release: () => Promise<void> } | undefined
    ;(navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {})
    const run = async () => {
      if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }))
      try {
        const raw = await extract(v, flow.file!, flow.corners!, flow.seeds!, {
          fps: flow.fps,
          signal: ac.signal,
          onProgress: (pr) => {
            setP(pr)
            if (pr.preview) drawPreview(pr.preview.pose)
          },
        })
        flow.raw = raw
        flow.drafts = detectRallies(raw, flow.seeds!, flow.fps)
        nav('/verify', { replace: true })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message || 'Analysis failed')
      }
    }
    run()
    return () => {
      ac.abort()
      lock?.release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const drawPreview = (poses: Record<string, number[]>) => {
    const c = overlay.current
    if (!c) return
    const r = c.getBoundingClientRect()
    c.width = r.width
    c.height = r.height
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, r.width, r.height)
    for (const s of flow.seeds ?? []) {
      const pose = poses[s.id]
      if (!pose) continue
      ctx.strokeStyle = s.color
      ctx.shadowColor = s.color
      ctx.shadowBlur = 8
      ctx.lineWidth = 2.5
      for (const [a, b] of BONES) {
        ctx.beginPath()
        ctx.moveTo(pose[a * 2] * r.width, pose[a * 2 + 1] * r.height)
        ctx.lineTo(pose[b * 2] * r.width, pose[b * 2 + 1] * r.height)
        ctx.stroke()
      }
    }
  }

  if (!flow.file || !flow.corners || !flow.seeds) return <Navigate to="/new" replace />
  const stageIdx = Math.max(0, STAGES.indexOf(p.phase))

  return (
    <div>
      <TopBar title="Analyzing your match" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={video} src={flow.url} muted playsInline preload="auto" className="block w-full" />
          <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" />
          <motion.div className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-lime/15 to-transparent" animate={{ top: ['-20%', '100%'] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }} />
          <div className="absolute left-3 top-3 chip !border-lime/30 !bg-black/60 !text-lime backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime" /> AI is watching
          </div>
        </div>
        <div className="card p-5">
          <div className="text-5xl font-black num">
            {Math.floor(p.pct)}
            <span className="text-2xl text-mute">%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full rounded-full bg-lime" animate={{ width: `${p.pct}%` }} transition={{ ease: 'easeOut' }} />
          </div>
          <div className="mt-2 text-sm text-mute">{p.detail ?? ' '}</div>
          <ol className="mt-5 space-y-3">
            {STAGES.map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-black ${i < stageIdx ? 'bg-lime text-ink' : i === stageIdx ? 'border-2 border-lime text-lime' : 'bg-white/8 text-mute'}`}>{i < stageIdx ? '✓' : i + 1}</span>
                <span className={i === stageIdx ? 'font-bold' : i < stageIdx ? 'text-soft' : 'text-mute'}>{s}</span>
              </li>
            ))}
          </ol>
          {error && <div className="mt-4 rounded-xl bg-red-500/15 p-3 text-sm text-red-300">{error}</div>}
          <p className="mt-5 text-xs text-mute">Keep this tab open and your screen on. Your video never leaves this device.</p>
          <button
            className="btn btn-ghost mt-4 w-full"
            onClick={() => {
              abort.current?.abort()
              nav('/setup')
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
