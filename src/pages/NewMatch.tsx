import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fmtTime, TopBar } from '../components/ui'
import { startFlow } from '../lib/flow'
import { useDemo } from './Home'

function pickRecorderMime() {
  const opts = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
  return opts.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

async function keepAwake() {
  try {
    return await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen')
  } catch {
    return undefined
  }
}

function Recorder() {
  const nav = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [rec, setRec] = useState<MediaRecorder | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const chunks = useRef<Blob[]>([])

  useEffect(() => {
    let s: MediaStream | null = null
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } }, audio: true })
      .then((st) => {
        s = st
        setStream(st)
        if (video.current) video.current.srcObject = st
      })
      .catch((e) => setError(e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera and microphone access to record.' : 'No camera available on this device. Upload a video instead.'))
    if (!navigator.mediaDevices) setError('Camera is not available here. Open KitchenIQ over HTTPS or upload a video instead.')
    return () => s?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => {
    if (!rec) return
    const t0 = Date.now()
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250)
    return () => clearInterval(id)
  }, [rec])

  const start = async () => {
    if (!stream) return
    chunks.current = []
    const mime = pickRecorderMime()
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined)
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    const lock = await keepAwake()
    r.onstop = () => {
      lock?.release()
      const blob = new Blob(chunks.current, { type: r.mimeType || 'video/webm' })
      startFlow(blob, `Match ${new Date().toLocaleDateString()}`)
      nav('/setup')
    }
    r.start(1000)
    setRec(r)
  }

  return (
    <div className="fixed inset-0 bg-black">
      <video ref={video} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      {/* framing guide */}
      {!rec && stream && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          <polygon points="34,22 66,22 92,92 8,92" fill="rgba(212,255,58,.06)" stroke="#d4ff3a" strokeWidth="0.4" strokeDasharray="1.5 1" vectorEffect="non-scaling-stroke" />
          <line x1="22" y1="50" x2="78" y2="50" stroke="#fff" strokeOpacity=".5" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <Link to="/new" className="grid h-10 w-10 place-items-center rounded-full bg-black/50 text-xl backdrop-blur">
          ✕
        </Link>
        {rec ? (
          <div className="flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1.5 font-mono text-sm font-bold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> {fmtTime(elapsed)}
          </div>
        ) : (
          <div className="rounded-full bg-black/50 px-3 py-1.5 text-xs font-semibold backdrop-blur">Fit the whole court inside the guide</div>
        )}
        <div className="w-10" />
      </div>
      {error && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center">
          <div>
            <div className="mb-4 text-soft">{error}</div>
            <Link to="/new" className="btn btn-primary">
              Upload instead
            </Link>
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        {!rec && stream && <div className="text-center text-xs text-white/70">Landscape, phone high on the fence behind the baseline. Keep the screen on.</div>}
        <button
          disabled={!stream}
          onClick={() => (rec ? rec.stop() : start())}
          className="grid h-20 w-20 place-items-center rounded-full border-4 border-white/90"
          aria-label={rec ? 'Stop recording' : 'Start recording'}
        >
          <motion.span animate={{ borderRadius: rec ? 8 : 40, width: rec ? 30 : 62, height: rec ? 30 : 62 }} className="block bg-red-500" />
        </button>
      </div>
    </div>
  )
}

export default function NewMatch({ record }: { record?: boolean }) {
  const nav = useNavigate()
  const demo = useDemo()
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  if (record) return <Recorder />

  const take = (f?: File | null) => {
    if (!f || !f.type.startsWith('video')) return
    startFlow(f, f.name.replace(/\.[^.]+$/, ''))
    nav('/setup')
  }

  return (
    <div>
      <TopBar back title="Analyze a match" />
      <div className="grid gap-4 md:grid-cols-2">
        <Link to="/record" className="card-hi group relative flex min-h-48 flex-col justify-end overflow-hidden p-6">
          <div className="absolute right-5 top-5 grid h-14 w-14 place-items-center rounded-full bg-red-500/90 shadow-[0_0_40px_rgba(239,68,68,.5)]">
            <span className="h-5 w-5 rounded-full bg-white" />
          </div>
          <div className="text-2xl font-black">Record a match</div>
          <div className="text-sm text-soft">Use this phone’s camera. Mount it on the fence and hit record.</div>
        </Link>
        <button
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            take(e.dataTransfer.files[0])
          }}
          className={`card flex min-h-48 flex-col items-start justify-end p-6 text-left transition ${drag ? '!border-lime' : 'hover:border-white/25'}`}
        >
          <div className="mb-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/8 text-2xl">⇪</div>
          <div className="text-2xl font-black">Upload a video</div>
          <div className="text-sm text-soft">MP4, MOV or WebM from your camera roll. Drag and drop works too.</div>
        </button>
        <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => take(e.target.files?.[0])} />
      </div>

      <div className="card mt-4 p-5">
        <div className="label mb-3">Film it right for the best analysis</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['📐', 'Behind the baseline, up high', 'Mount on the fence 6–10 ft up, centred. All 4 court corners must be visible.'],
            ['↔', 'Landscape, 1080p or 4K', '60 fps if you can. Don’t zoom; keep the phone still.'],
            ['🔊', 'Leave the mic on', 'KitchenIQ hears each paddle pop to time every shot.'],
            ['🔋', 'One game per video', 'Start recording before the first serve, stop after the last point.'],
          ].map(([i, t, d]) => (
            <div key={t} className="flex gap-3">
              <span className="text-xl">{i}</span>
              <div>
                <div className="font-bold">{t}</div>
                <div className="text-sm text-mute">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 text-center text-sm text-mute">
        No video handy?{' '}
        <button className="font-bold text-lime" onClick={() => demo(Math.floor(Math.random() * 1000) + 10)}>
          Generate a demo match
        </button>
      </div>
    </div>
  )
}
