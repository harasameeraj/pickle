import { motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Segmented, TopBar } from '../components/ui'
import { applyH, CORNER_ORDER, courtLines, homographies, PLAYER_COLORS } from '../lib/court'
import { loadSettings } from '../lib/db'
import { flow } from '../lib/flow'
import { ensureDuration, type PlayerSeed } from '../lib/pipeline'
import type { TeamId, Vec2 } from '../lib/types'
import { feet, compactPose, getPoseLandmarker, nextTs } from '../lib/vision'

const SLOTS: { id: string; team: TeamId; label: string }[] = [
  { id: 'p1', team: 0, label: 'Near team · left' },
  { id: 'p2', team: 0, label: 'Near team · right' },
  { id: 'p3', team: 1, label: 'Far team · left' },
  { id: 'p4', team: 1, label: 'Far team · right' },
]

type Step = 'corners' | 'players' | 'details'

export default function Setup() {
  const nav = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const loupe = useRef<HTMLCanvasElement>(null)
  const settings = loadSettings()
  const [step, setStep] = useState<Step>('corners')
  const [aspect, setAspect] = useState(16 / 9)
  const [duration, setDuration] = useState(0)
  const [frameT, setFrameT] = useState(2)
  const [corners, setCorners] = useState<Vec2[]>(flow.corners ?? [])
  const [feetPts, setFeetPts] = useState<Record<string, Vec2>>({})
  const [activeSlot, setActiveSlot] = useState('p1')
  const [names, setNames] = useState<Record<string, string>>({ p1: settings.name || 'You', p2: 'Partner', p3: 'Opponent 1', p4: 'Opponent 2' })
  const [me, setMe] = useState('p1')
  const [drag, setDrag] = useState<number | null>(null)
  const [loupeAt, setLoupeAt] = useState<Vec2 | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [firstServer, setFirstServer] = useState<'0' | '1'>('0')
  const [gameTo, setGameTo] = useState<'11' | '15' | '21'>('11')
  const [quality, setQuality] = useState<'6' | '10' | '15'>('10')
  const [title, setTitle] = useState(flow.name ?? 'My match')

  const H = useMemo(() => (corners.length === 4 ? homographies(corners) : null), [corners])

  useEffect(() => {
    const v = video.current
    if (!v) return
    const onMeta = async () => {
      setAspect(v.videoWidth / v.videoHeight || 16 / 9)
      await ensureDuration(v)
      setDuration(v.duration)
      v.currentTime = Math.min(2, v.duration / 2)
    }
    v.addEventListener('loadedmetadata', onMeta)
    return () => v.removeEventListener('loadedmetadata', onMeta)
  }, [])

  if (!flow.url) return <Navigate to="/new" replace />

  const toNorm = (e: React.PointerEvent): Vec2 => {
    const r = box.current!.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }
  }

  const drawLoupe = (p: Vec2) => {
    const c = loupe.current
    const v = video.current
    if (!c || !v) return
    const ctx = c.getContext('2d')!
    const vw = v.videoWidth
    const vh = v.videoHeight
    const s = Math.max(40, vw * 0.06)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(v, p.x * vw - s / 2, p.y * vh - s / 2, s, s, 0, 0, c.width, c.height)
    ctx.strokeStyle = '#d4ff3a'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(c.width / 2, 0)
    ctx.lineTo(c.width / 2, c.height)
    ctx.moveTo(0, c.height / 2)
    ctx.lineTo(c.width, c.height / 2)
    ctx.stroke()
  }

  const onDown = (e: React.PointerEvent) => {
    const p = toNorm(e)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* some synthetic or legacy pointers can't be captured */
    }
    if (step === 'corners') {
      const near = corners.findIndex((c) => Math.hypot(c.x - p.x, (c.y - p.y) / aspect) < 0.03)
      if (near >= 0) setDrag(near)
      else if (corners.length < 4) {
        setCorners([...corners, p])
        setDrag(corners.length)
      }
    } else if (step === 'players') {
      setFeetPts({ ...feetPts, [activeSlot]: p })
      const nextEmpty = SLOTS.find((s) => s.id !== activeSlot && !feetPts[s.id])
      if (nextEmpty) setActiveSlot(nextEmpty.id)
    }
    setLoupeAt(p)
    drawLoupe(p)
  }
  const onMove = (e: React.PointerEvent) => {
    if (drag === null) return
    const p = toNorm(e)
    setCorners(corners.map((c, i) => (i === drag ? p : c)))
    setLoupeAt(p)
    drawLoupe(p)
  }
  const onUp = () => {
    setDrag(null)
    setLoupeAt(null)
  }

  const autoDetect = async () => {
    if (!video.current || !H) return
    setDetecting(true)
    try {
      const lm = await getPoseLandmarker('full', 6)
      const res = lm.detectForVideo(video.current, nextTs())
      const found = res.landmarks
        .map((l) => {
          const f = feet(compactPose(l))
          return { img: f, court: applyH(H.toCourt, f) }
        })
        .filter((c) => c.court.x > -6 && c.court.x < 26 && c.court.y > -8 && c.court.y < 52)
      const near = found.filter((c) => c.court.y >= 22).sort((a, b) => a.court.x - b.court.x)
      const far = found.filter((c) => c.court.y < 22).sort((a, b) => a.court.x - b.court.x)
      const next: Record<string, Vec2> = { ...feetPts }
      if (near[0]) next.p1 = near[0].img
      if (near[1]) next.p2 = near[near.length - 1].img
      if (far[0]) next.p3 = far[0].img
      if (far[1]) next.p4 = far[far.length - 1].img
      setFeetPts(next)
    } catch {
      alert('Could not load the vision model. Check your connection, or tap the players manually.')
    }
    setDetecting(false)
  }

  const goAnalyze = () => {
    const seeds: PlayerSeed[] = SLOTS.map((s, i) => ({
      id: s.id,
      name: names[s.id].trim() || s.label,
      team: s.team,
      color: PLAYER_COLORS[i],
      isMe: me === s.id,
      foot: feetPts[s.id],
    }))
    flow.corners = corners
    flow.seeds = seeds
    flow.settings = { gameTo: +gameTo, firstServer: +firstServer as TeamId }
    flow.fps = +quality
    flow.name = title
    flow.setupTime = video.current?.currentTime ?? 0
    nav('/analyzing')
  }

  const lines = H ? courtLines().map(([a, b]) => [applyH(H.toImage, a), applyH(H.toImage, b)]) : []
  const net = H ? [applyH(H.toImage, { x: -1, y: 22 }), applyH(H.toImage, { x: 21, y: 22 })] : null
  const stepIdx = ['corners', 'players', 'details'].indexOf(step)

  return (
    <div>
      <TopBar back="/new" title="Set up your match" />
      <div className="mb-4 flex gap-1.5">
        {['Court', 'Players', 'Details'].map((l, i) => (
          <div key={l} className="flex-1">
            <div className={`h-1 rounded-full ${i <= stepIdx ? 'bg-lime' : 'bg-white/10'}`} />
            <div className={`mt-1 text-xs font-bold ${i === stepIdx ? 'text-white' : 'text-mute'}`}>{l}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className={step === 'details' ? 'hidden lg:block' : ''}>
          <div ref={box} className="relative w-full touch-none select-none overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: aspect }} onPointerDown={step === 'details' ? undefined : onDown} onPointerMove={onMove} onPointerUp={onUp}>
            <video ref={video} src={flow.url} muted playsInline preload="auto" className="absolute inset-0 h-full w-full" crossOrigin="anonymous" />
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
              {corners.length >= 2 && <polygon points={corners.map((c) => `${c.x},${c.y}`).join(' ')} fill="rgba(212,255,58,.1)" stroke="#d4ff3a" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
              {lines.map(([a, b], i) => (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fff" strokeWidth="1.5" strokeOpacity=".85" vectorEffect="non-scaling-stroke" />
              ))}
              {net && <line x1={net[0].x} y1={net[0].y} x2={net[1].x} y2={net[1].y} stroke="#d4ff3a" strokeWidth="3" vectorEffect="non-scaling-stroke" />}
            </svg>
            {corners.map((c, i) => (
              <div key={i} className="pointer-events-none absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-ink bg-lime text-xs font-black text-ink shadow-lg" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}>
                {i + 1}
              </div>
            ))}
            {step !== 'corners' &&
              SLOTS.map((s, i) =>
                feetPts[s.id] ? (
                  <motion.div key={s.id} initial={{ scale: 0 }} animate={{ scale: 1 }} className="pointer-events-none absolute -translate-x-1/2 -translate-y-full" style={{ left: `${feetPts[s.id].x * 100}%`, top: `${feetPts[s.id].y * 100}%` }}>
                    <div className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black text-ink" style={{ background: PLAYER_COLORS[i] }}>
                      {names[s.id]}
                    </div>
                    <div className="mx-auto h-3 w-0.5" style={{ background: PLAYER_COLORS[i] }} />
                    <div className="mx-auto -mt-1 h-3 w-3 rounded-full border-2 border-ink" style={{ background: PLAYER_COLORS[i] }} />
                  </motion.div>
                ) : null,
              )}
            <div className={`pointer-events-none absolute top-3 overflow-hidden rounded-full border-2 border-lime shadow-2xl transition-opacity ${loupeAt ? 'opacity-100' : 'opacity-0'} ${loupeAt && loupeAt.x < 0.5 ? 'right-3' : 'left-3'}`}>
              <canvas ref={loupe} width={130} height={130} className="block" />
            </div>
          </div>
          {step !== 'details' && duration > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-mute">Frame</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={frameT}
                onChange={(e) => {
                  setFrameT(+e.target.value)
                  if (video.current) video.current.currentTime = +e.target.value
                }}
                className="flex-1"
              />
            </div>
          )}
        </div>

        <div className="space-y-3">
          {step === 'corners' && (
            <div className="card p-5">
              <div className="text-lg font-extrabold">Tap the 4 court corners</div>
              <p className="mt-1 text-sm text-mute">Use the outer corners of the court lines, in this order. Drag a dot to fine-tune it. Pick a frame where the lines are clear.</p>
              <ol className="mt-4 space-y-2">
                {CORNER_ORDER.map((c, i) => (
                  <li key={c.label} className={`flex items-center gap-3 rounded-xl p-2 ${corners.length === i ? 'bg-lime/10' : ''}`}>
                    <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black ${corners[i] ? 'bg-lime text-ink' : 'bg-white/8 text-mute'}`}>{corners[i] ? '✓' : i + 1}</span>
                    <span className={corners.length === i ? 'font-bold' : 'text-soft'}>{c.label}</span>
                  </li>
                ))}
              </ol>
              {corners.length === 4 && <p className="mt-3 text-sm text-lime">Check the white lines match the real court lines. If they do, you’re set.</p>}
              <div className="mt-4 flex gap-2">
                <button className="btn btn-ghost" onClick={() => setCorners([])}>
                  Reset
                </button>
                <button className="btn btn-primary flex-1" disabled={corners.length < 4} onClick={() => setStep('players')}>
                  Court looks right
                </button>
              </div>
            </div>
          )}

          {step === 'players' && (
            <div className="card p-5">
              <div className="text-lg font-extrabold">Who’s playing?</div>
              <p className="mt-1 text-sm text-mute">Select a player, then tap their feet in the frame. Or let the AI find them.</p>
              <button className="btn btn-ghost mt-3 w-full" onClick={autoDetect} disabled={detecting}>
                {detecting ? 'Looking for players…' : '✦ Auto-detect players'}
              </button>
              <div className="mt-3 space-y-2">
                {SLOTS.map((s, i) => (
                  <div key={s.id} onClick={() => setActiveSlot(s.id)} className={`rounded-xl border p-2.5 transition ${activeSlot === s.id ? 'border-lime bg-lime/5' : 'border-line'}`}>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[i] }} />
                      <span className="text-xs font-bold text-mute">{s.label}</span>
                      <span className={`ml-auto text-xs font-bold ${feetPts[s.id] ? 'text-lime' : 'text-orange-300'}`}>{feetPts[s.id] ? '✓ placed' : 'tap feet'}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input value={names[s.id]} onChange={(e) => setNames({ ...names, [s.id]: e.target.value })} className="min-w-0 flex-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-sm font-semibold outline-none focus:ring-1 focus:ring-lime" />
                      <label className="flex items-center gap-1 text-xs text-soft">
                        <input type="radio" name="me" checked={me === s.id} onChange={() => setMe(s.id)} className="accent-lime" /> Me
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button className="btn btn-ghost" onClick={() => setStep('corners')}>
                  Back
                </button>
                <button className="btn btn-primary flex-1" disabled={SLOTS.some((s) => !feetPts[s.id])} onClick={() => setStep('details')}>
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 'details' && (
            <div className="card space-y-4 p-5">
              <div>
                <div className="label mb-1.5">Match name</div>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl bg-white/5 px-3 py-2.5 font-semibold outline-none focus:ring-1 focus:ring-lime" />
              </div>
              <div>
                <div className="label mb-1.5">Who served first?</div>
                <Segmented
                  value={firstServer}
                  onChange={setFirstServer}
                  options={[
                    { value: '0', label: `${names.p1} & ${names.p2}` },
                    { value: '1', label: `${names.p3} & ${names.p4}` },
                  ]}
                />
              </div>
              <div>
                <div className="label mb-1.5">Game to</div>
                <Segmented value={gameTo} onChange={setGameTo} options={[{ value: '11', label: '11' }, { value: '15', label: '15' }, { value: '21', label: '21' }]} />
              </div>
              <div>
                <div className="label mb-1.5">Analysis detail</div>
                <Segmented value={quality} onChange={setQuality} options={[{ value: '6', label: 'Fast' }, { value: '10', label: 'Standard' }, { value: '15', label: 'Precise' }]} />
                <div className="mt-1.5 text-xs text-mute">Precise tracks more frames and takes longer. Everything runs on this device.</div>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn btn-ghost" onClick={() => setStep('players')}>
                  Back
                </button>
                <button className="btn btn-primary flex-1" onClick={goAnalyze}>
                  ✦ Analyze match
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
