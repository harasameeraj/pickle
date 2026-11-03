import { motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SHOT_LABEL } from '../lib/analyze'
import { rallyEnd } from '../lib/ballpath'
import type { Match, Rally, Shot } from '../lib/types'
import { ReplayScene } from './replay3d'
import { GRADE_META, GradeBadge } from './ui'

interface Highlight {
  rally: Rally
  shot: Shot
  score: number
}

export function pickHighlights(m: Match, max = 6): Highlight[] {
  const out: Highlight[] = []
  for (const r of m.rallies) {
    for (const s of r.shots) {
      let score = 0
      if (s.grade === 'brilliant') score = 100
      else if (s.outcome === 'winner' && s.grade === 'great') score = 70
      else if (s.grade === 'great') score = 45
      else if (s.outcome === 'winner') score = 40
      if (score && r.shots.length >= 8) score += r.shots.length
      if (score) out.push({ rally: r, shot: s, score })
    }
  }
  const seen = new Set<number>()
  return out
    .sort((a, b) => b.score - a.score)
    .filter((h) => (seen.has(h.rally.index) ? false : (seen.add(h.rally.index), true)))
    .slice(0, max)
    .sort((a, b) => a.rally.index - b.rally.index)
}

const RW = 720
const RH = 1280

function pickMime() {
  const opts = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  return opts.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? ''
}

export default function HighlightStudio({ match, onWatch, videoUrl }: { match: Match; onWatch: (rally: number, shot: number) => void; videoUrl?: string }) {
  const hl = useMemo(() => pickHighlights(match), [match])
  const [selected, setSelected] = useState<Set<number>>(() => new Set(hl.map((h) => h.rally.index)))
  const [state, setState] = useState<'idle' | 'rendering' | 'done'>('idle')
  const [progress, setProgress] = useState(0)
  const [out, setOut] = useState<{ url: string; ext: string } | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const cancel = useRef(false)
  const name = (id: string) => match.players.find((p) => p.id === id)?.name ?? ''

  useEffect(() => () => {
    cancel.current = true
    if (out) URL.revokeObjectURL(out.url)
  }, [out])

  const render = async () => {
    const list = hl.filter((h) => selected.has(h.rally.index))
    if (!list.length || !stage.current) return
    cancel.current = false
    setState('rendering')
    setProgress(0)
    const canvas = document.createElement('canvas')
    canvas.width = RW
    canvas.height = RH
    const ctx = canvas.getContext('2d')!
    const mime = pickMime()
    const stream = canvas.captureStream(30)
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const stopped = new Promise<void>((res) => (rec.onstop = () => res()))
    rec.start(250)

    // source: real video when we have it, otherwise the 3D replay
    const host = stage.current
    let scene: ReplayScene | null = null
    let video: HTMLVideoElement | null = null
    if (videoUrl) {
      video = document.createElement('video')
      video.src = videoUrl
      video.muted = true
      video.playsInline = true
      await new Promise((r) => (video!.onloadeddata = r))
    } else {
      scene = new ReplayScene(host, match.players)
    }

    const frame = (draw: (t: number) => void, seconds: number) =>
      new Promise<void>((res) => {
        const t0 = performance.now()
        const tick = () => {
          const t = (performance.now() - t0) / 1000
          draw(Math.min(t, seconds))
          if (preview.current) preview.current.getContext('2d')!.drawImage(canvas, 0, 0, preview.current.width, preview.current.height)
          if (t >= seconds || cancel.current) return res()
          requestAnimationFrame(tick)
        }
        tick()
      })

    const bg = () => {
      const g = ctx.createLinearGradient(0, 0, 0, RH)
      g.addColorStop(0, '#0c1f17')
      g.addColorStop(1, '#050c09')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, RW, RH)
    }
    const brand = () => {
      ctx.fillStyle = '#d4ff3a'
      ctx.beginPath()
      ctx.arc(64, 84, 22, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = '900 34px Inter, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillStyle = '#fff'
      ctx.fillText('Kitchen', 100, 96)
      ctx.fillStyle = '#d4ff3a'
      ctx.fillText('IQ', 100 + ctx.measureText('Kitchen').width, 96)
    }

    // intro
    await frame((t) => {
      bg()
      brand()
      const a = Math.min(1, t / 0.4)
      ctx.globalAlpha = a
      ctx.textAlign = 'center'
      ctx.fillStyle = '#8aa597'
      ctx.font = '700 30px Inter, sans-serif'
      ctx.fillText('MATCH HIGHLIGHTS', RW / 2, RH / 2 - 60)
      ctx.fillStyle = '#fff'
      ctx.font = '900 64px Inter, sans-serif'
      ctx.fillText(`${match.finalScore[0]} – ${match.finalScore[1]}`, RW / 2, RH / 2 + 20)
      ctx.font = '600 28px Inter, sans-serif'
      ctx.fillStyle = '#c9dbd0'
      ctx.fillText(match.title, RW / 2, RH / 2 + 80)
      ctx.globalAlpha = 1
    }, 1.6)

    for (let i = 0; i < list.length && !cancel.current; i++) {
      const { rally, shot } = list[i]
      const startT = Math.max(rally.shots[0].t - 0.5, shot.t - 4)
      const endT = Math.min(rallyEnd(rally), shot.t + 2.2)
      // real-time until the key shot, slow motion around it
      const timeline: { at: number; real: number }[] = []
      let sim = startT
      let real = 0
      while (sim < endT) {
        timeline.push({ at: sim, real })
        const slow = Math.abs(sim - shot.t) < 0.9
        sim += (slow ? 0.35 : 1) / 30
        real += 1 / 30
      }
      if (scene) {
        scene.setRally(rally)
        scene.setView(i % 2 ? 'baseline' : 'broadcast')
        scene.seek(startT)
      }
      if (video) {
        video.currentTime = startT
        await new Promise((r) => (video!.onseeked = r))
      }
      const meta = GRADE_META[shot.grade]
      await frame((t) => {
        const idx = Math.min(timeline.length - 1, Math.floor(t * 30))
        const simT = timeline[idx].at
        bg()
        brand()
        // source frame
        if (scene) {
          scene.step(simT)
          ctx.drawImage(scene.canvas, 0, 0, scene.canvas.width, scene.canvas.height, 0, 200, RW, RW)
        } else if (video) {
          const slow = Math.abs(simT - shot.t) < 0.9
          video.playbackRate = slow ? 0.35 : 1
          if (video.paused) video.play().catch(() => {})
          const vh = RW / (video.videoWidth / video.videoHeight)
          ctx.drawImage(video, 0, 200 + (RW - vh) / 2, RW, vh)
        }
        // slow-mo tag
        if (Math.abs(simT - shot.t) < 0.9) {
          ctx.fillStyle = 'rgba(0,0,0,.55)'
          ctx.beginPath()
          ctx.roundRect(RW - 210, 220, 190, 44, 22)
          ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.font = '800 22px Inter, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('◉ SLOW-MO', RW - 115, 250)
        }
        // caption
        const shown = simT >= shot.t
        const pop = shown ? Math.min(1, (simT - shot.t) / 0.25) : 0
        ctx.textAlign = 'center'
        ctx.fillStyle = '#8aa597'
        ctx.font = '700 26px Inter, sans-serif'
        ctx.fillText(`RALLY ${rally.index + 1} · ${rally.scoreBefore.points[0]}–${rally.scoreBefore.points[1]}`, RW / 2, 990)
        if (pop > 0) {
          const r = 54 * (pop < 1 ? pop * 1.15 : 1)
          ctx.shadowColor = meta.color
          ctx.shadowBlur = 40
          ctx.fillStyle = meta.color
          ctx.beginPath()
          ctx.arc(RW / 2, 1060, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
          ctx.fillStyle = '#07110d'
          ctx.font = `900 ${meta.symbol.length > 1 ? 44 : 56}px Inter, sans-serif`
          ctx.fillText(meta.symbol, RW / 2, 1078)
          ctx.globalAlpha = pop
          ctx.fillStyle = meta.color
          ctx.font = '900 56px Inter, sans-serif'
          ctx.fillText(meta.label.toUpperCase(), RW / 2, 1170)
          ctx.fillStyle = '#fff'
          ctx.font = '700 30px Inter, sans-serif'
          ctx.fillText(`${name(shot.hitter)} · ${SHOT_LABEL[shot.type]}`, RW / 2, 1215)
          ctx.globalAlpha = 1
        }
        setProgress((i + t / (timeline.length / 30)) / list.length)
      }, timeline.length / 30)
      video?.pause()
    }

    await frame((t) => {
      bg()
      ctx.globalAlpha = Math.min(1, t / 0.4)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#d4ff3a'
      ctx.font = '900 52px Inter, sans-serif'
      ctx.fillText('KitchenIQ', RW / 2, RH / 2 - 10)
      ctx.fillStyle = '#c9dbd0'
      ctx.font = '600 28px Inter, sans-serif'
      ctx.fillText('Every shot graded. Every mistake fixed.', RW / 2, RH / 2 + 40)
      ctx.globalAlpha = 1
    }, 1.8)

    rec.stop()
    await stopped
    scene?.dispose()
    if (cancel.current) {
      setState('idle')
      return
    }
    const type = rec.mimeType || 'video/webm'
    const blob = new Blob(chunks, { type })
    setOut({ url: URL.createObjectURL(blob), ext: type.includes('mp4') ? 'mp4' : 'webm' })
    setState('done')
  }

  if (!hl.length)
    return <div className="card p-8 text-center text-mute">No highlight-worthy shots in this match yet. Keep playing!</div>

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_300px]">
      <div className="space-y-2">
        <div className="label mb-1">Pick your highlights</div>
        {hl.map((h, i) => {
          const on = selected.has(h.rally.index)
          return (
            <motion.div key={h.rally.index} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={`card flex items-center gap-3 p-3 ${on ? '' : 'opacity-50'}`}>
              <button
                onClick={() => {
                  const n = new Set(selected)
                  if (on) n.delete(h.rally.index)
                  else n.add(h.rally.index)
                  setSelected(n)
                }}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 text-xs font-black ${on ? 'border-lime bg-lime text-ink' : 'border-line'}`}
                aria-label="Include highlight"
              >
                {on ? '✓' : ''}
              </button>
              <GradeBadge grade={h.shot.grade} size={30} />
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {name(h.shot.hitter)} · {SHOT_LABEL[h.shot.type]}
                </div>
                <div className="truncate text-xs text-mute">
                  Rally {h.rally.index + 1} · {h.rally.shots.length} shots · {h.shot.note}
                </div>
              </div>
              <button onClick={() => onWatch(h.rally.index, h.shot.index)} className="text-sm font-bold text-lime">
                ▶
              </button>
            </motion.div>
          )
        })}
      </div>
      <div className="card flex flex-col items-center gap-3 p-4">
        <div className="relative aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-2xl bg-black">
          {out ? <video src={out.url} controls playsInline className="h-full w-full" /> : <canvas ref={preview} width={270} height={480} className="h-full w-full" />}
          {state === 'idle' && !out && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-mute">Vertical reel with slow-mo and shot grades, ready for Reels, TikTok and Shorts.</div>
          )}
        </div>
        {state === 'rendering' && (
          <div className="w-full">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-lime transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
            <button onClick={() => (cancel.current = true)} className="mt-2 w-full text-sm text-mute">
              Cancel
            </button>
          </div>
        )}
        {state !== 'rendering' && (
          <button onClick={render} disabled={!selected.size} className="btn btn-primary w-full">
            {out ? '↻ Render again' : '✦ Create highlight reel'}
          </button>
        )}
        {out && (
          <a href={out.url} download={`kitcheniq-highlights.${out.ext}`} className="btn btn-ghost w-full">
            ⤓ Save video
          </a>
        )}
      </div>
      {/* off-screen stage for the 3D renderer */}
      <div ref={stage} style={{ position: 'fixed', left: -2000, top: 0, width: 720, height: 720 }} aria-hidden />
    </div>
  )
}
