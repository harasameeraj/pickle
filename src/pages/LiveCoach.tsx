import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CoachAvatar } from '../components/CoachPanel'
import { AccuracyRing, fmtTime } from '../components/ui'
import { cue, PERSONAS } from '../lib/coach'
import { loadSettings, saveSession, uid } from '../lib/db'
import { dinkEngine, readyEngine, serveEngine, type DrillEngine, type DrillOutput, type Feedback, type RepResult } from '../lib/liveDrills'
import { BONES, compactPose, getPoseLandmarker, K, nextTs } from '../lib/vision'
import { LIVE_DRILLS } from './Coach'

type Phase = 'intro' | 'countdown' | 'live' | 'summary'
const SESSION_SECONDS = 90

const FAULT_TEXT: Record<string, string> = {
  knees: 'Not enough knee bend',
  swing: 'Swing too big',
  contact: 'Contact too high',
  height: 'Contact above the waist',
  path: 'Flat or downward swing',
  follow: 'Short follow-through',
}

export default function LiveCoach() {
  const { drill = 'dink' } = useParams()
  const nav = useNavigate()
  const meta = LIVE_DRILLS.find((d) => d.id === drill) ?? LIVE_DRILLS[1]
  const settings = loadSettings()
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const engine = useRef<DrillEngine | null>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [count, setCount] = useState(3)
  const [out, setOut] = useState<DrillOutput | null>(null)
  const [toast, setToast] = useState<(Feedback & { id: number }) | null>(null)
  const [inFrame, setInFrame] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [log, setLog] = useState<RepResult[]>([])
  const started = useRef(0)
  const outRef = useRef<DrillOutput | null>(null)
  const lastCue = useRef(0)

  // camera
  useEffect(() => {
    let stream: MediaStream | null = null
    setReady(false)
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        stream = s
        if (video.current) {
          video.current.srcObject = s
          video.current.onloadeddata = () => setReady(true)
        }
      })
      .catch(() => setError('Camera access is needed for Live Coach. Allow camera permission and reload.'))
    if (!navigator.mediaDevices) setError('Camera is not available here. Open KitchenIQ over HTTPS on your phone.')
    return () => stream?.getTracks().forEach((t) => t.stop())
  }, [facing])

  // countdown
  useEffect(() => {
    if (phase !== 'countdown') return
    if (count === 0) {
      const mk = drill === 'ready' ? readyEngine : drill === 'serve' ? serveEngine : dinkEngine
      engine.current = mk(settings.hand, settings.persona)
      started.current = performance.now()
      setPhase('live')
      if (settings.voice) cue('Go!', settings.persona)
      return
    }
    if (settings.voice) cue(String(count), settings.persona)
    const id = setTimeout(() => setCount(count - 1), 900)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, count])

  // pose loop (runs in every phase so the skeleton is visible while positioning)
  useEffect(() => {
    if (!ready) return
    let raf = 0
    let alive = true
    let lastVideoT = -1
    let toastId = 0
    getPoseLandmarker('lite', 1).then((lm) => {
      const loop = () => {
        if (!alive) return
        raf = requestAnimationFrame(loop)
        const v = video.current
        const c = canvas.current
        if (!v || !c || v.readyState < 2 || v.currentTime === lastVideoT) return
        lastVideoT = v.currentTime
        const res = lm.detectForVideo(v, nextTs())
        const r = c.getBoundingClientRect()
        const dpr = Math.min(2, devicePixelRatio)
        if (c.width !== Math.round(r.width * dpr)) {
          c.width = Math.round(r.width * dpr)
          c.height = Math.round(r.height * dpr)
        }
        const ctx = c.getContext('2d')!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, r.width, r.height)
        const lmk = res.landmarks[0]
        if (!lmk) {
          setInFrame(false)
          return
        }
        const pose = compactPose(lmk)
        const visible = lmk[27].y < 1.02 && lmk[28].y < 1.02 && lmk[0].y > -0.02
        setInFrame(visible)
        // map normalised coords to the object-cover video rect
        const ar = v.videoWidth / v.videoHeight
        let w = r.width
        let h = w / ar
        if (h < r.height) {
          h = r.height
          w = h * ar
        }
        const ox = (r.width - w) / 2
        const oy = (r.height - h) / 2
        const P = (i: number) => [ox + pose[i * 2] * w, oy + pose[i * 2 + 1] * h] as const

        let o: DrillOutput | null = null
        const now = performance.now()
        if (engine.current && started.current) {
          const t = (now - started.current) / 1000
          o = engine.current.update(t, pose)
          outRef.current = o
          setOut(o)
          setElapsed(t)
          if (o.feedback) {
            setToast({ ...o.feedback, id: ++toastId })
            if (settings.voice && o.feedback.say && now - lastCue.current > 2200) {
              lastCue.current = now
              cue(o.feedback.say, settings.persona)
            }
            if (o.feedback.tone === 'bad') navigator.vibrate?.(60)
          }
          if (t >= SESSION_SECONDS) finish()
        }
        const bad = new Set(o?.badJoints ?? [])
        ctx.lineCap = 'round'
        for (const [a, b] of BONES) {
          const A = P(a)
          const B = P(b)
          const isBad = bad.has(a) || bad.has(b)
          ctx.strokeStyle = isBad ? '#ef4444' : '#d4ff3a'
          ctx.shadowColor = ctx.strokeStyle
          ctx.shadowBlur = isBad ? 22 : 10
          ctx.lineWidth = isBad ? 7 : 4
          ctx.beginPath()
          ctx.moveTo(A[0], A[1])
          ctx.lineTo(B[0], B[1])
          ctx.stroke()
        }
        for (let i = 1; i < 13; i++) {
          const [x, y] = P(i)
          const isBad = bad.has(i)
          ctx.fillStyle = isBad ? '#ef4444' : '#07110d'
          ctx.strokeStyle = isBad ? '#fecaca' : '#d4ff3a'
          ctx.shadowBlur = isBad ? 24 : 0
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(x, y, isBad ? 9 + Math.sin(now / 90) * 2 : 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
        ctx.shadowBlur = 0
        // knee angle readout for dink drill
        if (drill !== 'serve' && o) {
          const knee = P(settings.hand === 'right' ? K.rKnee : K.lKnee)
          const m = o.metrics.find((x) => x.label === 'Knee bend')
          if (m && m.value !== '–') {
            ctx.save()
            if (facing === 'user') {
              ctx.translate(knee[0], 0)
              ctx.scale(-1, 1)
              ctx.translate(-knee[0], 0)
            }
            ctx.font = '800 14px Inter, sans-serif'
            ctx.fillStyle = m.good ? '#d4ff3a' : '#ef4444'
            ctx.fillText(m.value, knee[0] + 14, knee[1] + 5)
            ctx.restore()
          }
        }
      }
      loop()
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, facing])

  const finish = () => {
    const e = engine.current
    if (!e) return
    engine.current = null
    setLog([...e.repLog])
    const secs = (performance.now() - started.current) / 1000
    started.current = 0
    setPhase('summary')
    const last = outRef.current
    const score = last?.score ?? 0
    saveSession({ id: uid(), drill, at: Date.now(), reps: last?.reps ?? e.repLog.length, score, seconds: secs })
    if (settings.voice) cue(score >= 80 ? 'Great session.' : 'Session done. Let’s look at it.', settings.persona)
  }

  const mirror = facing === 'user' ? 'scale-x-[-1]' : ''

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <video ref={video} autoPlay playsInline muted className={`absolute inset-0 h-full w-full object-cover ${mirror}`} />
      <canvas ref={canvas} className={`pointer-events-none absolute inset-0 h-full w-full ${mirror}`} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60" />

      {/* HUD top */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-3 p-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <Link to="/coach" className="grid h-10 w-10 place-items-center rounded-full bg-black/50 text-lg backdrop-blur">
          ✕
        </Link>
        <div className="min-w-0">
          <div className="text-xs font-bold" style={{ color: meta.color }}>
            LIVE COACH
          </div>
          <div className="truncate font-black">{meta.name}</div>
        </div>
        {phase === 'live' && (
          <div className="ml-auto flex items-center gap-2">
            <div className="rounded-full bg-black/50 px-3 py-1.5 font-mono text-sm font-bold backdrop-blur">{fmtTime(Math.max(0, SESSION_SECONDS - elapsed))}</div>
            <div className="rounded-full bg-black/50 px-3 py-1.5 text-sm font-bold backdrop-blur">
              {drill === 'ready' ? 'Recoveries' : 'Reps'} <span className="text-lime">{out?.reps ?? 0}</span>
            </div>
          </div>
        )}
        {phase !== 'live' && (
          <button onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-black/50 backdrop-blur" aria-label="Switch camera">
            ⟲
          </button>
        )}
      </div>

      {/* score ring */}
      {phase === 'live' && out && (
        <div className="absolute right-4 top-24 rounded-3xl bg-black/45 p-2 backdrop-blur">
          <AccuracyRing value={out.score} size={74} color={out.score >= 80 ? '#d4ff3a' : out.score >= 60 ? '#facc15' : '#fb923c'} />
          <div className="text-center text-[10px] font-bold text-mute">FORM</div>
        </div>
      )}

      {!inFrame && phase !== 'summary' && ready && (
        <div className="absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-orange-500/90 px-4 py-2 text-sm font-bold">Step back: show your whole body</div>
      )}

      {/* metrics + feedback */}
      {phase === 'live' && (
        <div className="absolute inset-x-0 bottom-0 space-y-3 p-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          <AnimatePresence mode="popLayout">
            {toast && (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                className={`mx-auto flex max-w-md items-center gap-3 rounded-2xl border p-3 backdrop-blur-md ${toast.tone === 'good' ? 'border-lime/40 bg-lime/15' : 'border-red-400/40 bg-red-500/20'}`}
              >
                <CoachAvatar persona={settings.persona} size={38} talking />
                <div className="text-base font-extrabold">{toast.text}</div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
            {out?.metrics.map((m) => (
              <div key={m.label} className={`rounded-xl border px-2 py-2 text-center backdrop-blur ${m.good ? 'border-white/10 bg-black/45' : 'border-red-400/50 bg-red-500/20'}`}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-white/60">{m.label}</div>
                <div className="truncate text-sm font-black">{m.value}</div>
              </div>
            ))}
          </div>
          <button onClick={finish} className="btn btn-ghost mx-auto block !bg-black/50 backdrop-blur">
            End session
          </button>
        </div>
      )}

      {/* intro */}
      {phase === 'intro' && (
        <div className="absolute inset-x-0 bottom-0 p-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="card mx-auto max-w-md p-5">
            <div className="flex items-center gap-3">
              <CoachAvatar persona={settings.persona} size={46} />
              <div>
                <div className="text-xs text-mute">{PERSONAS[settings.persona].name}</div>
                <div className="font-black">{meta.name}</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-soft">{meta.desc}</p>
            <ul className="mt-3 space-y-1 text-sm text-mute">
              <li>• Prop the phone 2–3 m away, whole body in frame</li>
              <li>• Side-on works best for dinks and serves</li>
              <li>• {SESSION_SECONDS} second session · volume up for voice cues</li>
            </ul>
            {error ? (
              <div className="mt-4 rounded-xl bg-red-500/15 p-3 text-sm text-red-300">{error}</div>
            ) : (
              <button
                disabled={!ready}
                onClick={() => {
                  setCount(3)
                  setPhase('countdown')
                }}
                className="btn btn-primary mt-4 w-full"
              >
                {ready ? 'Start' : 'Starting camera…'}
              </button>
            )}
          </motion.div>
        </div>
      )}

      {phase === 'countdown' && (
        <div className="absolute inset-0 grid place-items-center">
          <AnimatePresence mode="popLayout">
            <motion.div key={count} initial={{ scale: 2.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className="text-[140px] font-black text-lime glow-lime">
              {count || 'GO'}
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {phase === 'summary' && (
        <Summary
          drill={meta.name}
          out={out}
          log={log}
          onAgain={() => {
            setOut(null)
            outRef.current = null
            setToast(null)
            setLog([])
            setCount(3)
            setPhase('countdown')
          }}
          onDone={() => nav('/coach')}
        />
      )}
    </div>
  )
}

function Summary({ drill, out, log, onAgain, onDone }: { drill: string; out: DrillOutput | null; log: RepResult[]; onAgain: () => void; onDone: () => void }) {
  const score = out?.score ?? 0
  const counts: Record<string, number> = {}
  for (const r of log) for (const f of r.faults) counts[f] = (counts[f] ?? 0) + 1
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2)
  const best = log.length ? Math.max(...log.map((r) => r.score)) : 0
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/70 p-4 backdrop-blur-md">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card w-full max-w-sm p-6 text-center">
        <div className="label">{drill} · session complete</div>
        <div className="my-4 flex justify-center">
          <AccuracyRing value={score} size={130} color={score >= 80 ? '#d4ff3a' : score >= 60 ? '#facc15' : '#fb923c'} />
        </div>
        <div className="text-xl font-black">{score >= 85 ? 'Locked in.' : score >= 70 ? 'Solid session.' : score >= 50 ? 'Getting there.' : 'Lots to work on.'}</div>
        <div className="mt-1 text-sm text-mute">
          {out?.reps ?? 0} reps tracked{log.length ? ` · best rep ${best}` : ''}
        </div>
        {top.length > 0 && (
          <div className="mt-3 space-y-1 text-left text-sm">
            {top.map(([f, n]) => (
              <div key={f} className="flex justify-between rounded-lg bg-white/5 px-3 py-1.5">
                <span className="text-soft">{FAULT_TEXT[f] ?? f}</span>
                <span className="font-bold text-orange-300">{n}×</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {out?.metrics.map((m) => (
            <div key={m.label} className={`rounded-xl p-2 ${m.good ? 'bg-lime/10' : 'bg-red-500/15'}`}>
              <div className="text-[10px] font-bold uppercase text-mute">{m.label}</div>
              <div className="text-sm font-black">{m.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onDone} className="btn btn-ghost flex-1">
            Done
          </button>
          <button onClick={onAgain} className="btn btn-primary flex-1">
            Go again
          </button>
        </div>
      </motion.div>
    </div>
  )
}

