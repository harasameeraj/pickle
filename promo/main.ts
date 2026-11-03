import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import lines from './audio/lines.json'
import { renderSoundtrack } from './music'
import { CUES, draw, DURATION, H, setCues, setup, W } from './scenes'

// WebCodecs audio types are missing from TypeScript 5.6's DOM lib
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const AudioEncoder: any
declare const AudioData: any

const FPS = 30
// when each voice line starts (seconds); captions are skipped where the scene already shows the words
const AT: Record<string, [number, boolean]> = {
  v1: [0.3, false],
  v2: [1.65, false],
  v3: [3.95, true],
  v4: [7.9, true],
  v5a: [13.0, true],
  v5b: [14.94, true], // "to blunder" lands on the 16.05 visual hit
  v6: [16.9, true],
  v7: [19.4, true],
  v8: [23.3, true],
  v9a: [26.4, false],
  v9b: [27.35, false],
  v10: [28.8, false],
}

const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.width = W
canvas.height = H
const ctx = canvas.getContext('2d')!
const status = document.getElementById('status')!
const say = (s: string) => {
  status.textContent = s
  ;(window as unknown as { __status: string }).__status = s
}

async function loadVoices() {
  const ac = new OfflineAudioContext(1, 1, 48000)
  const out = []
  for (const [id, [at, caption]] of Object.entries(AT)) {
    const buf = await fetch(`/promo/audio/${id}.wav`).then((r) => r.arrayBuffer())
    const buffer = await ac.decodeAudioData(buf)
    const meta = (lines as Record<string, { text: string; dur: number }>)[id]
    out.push({ cue: { id, at, dur: buffer.duration, text: meta.text, caption }, buffer })
  }
  setCues(out.map((v) => v.cue))
  return out
}

let ready: Promise<Awaited<ReturnType<typeof loadVoices>>> | null = null
async function init() {
  if (!ready) {
    ready = (async () => {
      await document.fonts.load('900 100px Inter')
      await document.fonts.load('800 100px Inter')
      await document.fonts.load('600 100px Inter')
      await document.fonts.load('900 60px "JetBrains Mono"')
      await document.fonts.ready
      await setup(document.getElementById('stage')!)
      return loadVoices()
    })()
  }
  return ready
}

async function preview(t: number) {
  await init()
  draw(ctx, t)
  return CUES.length
}

async function render(name = 'kitcheniq-promo.mp4') {
  const voices = await init()
  say('Composing soundtrack…')
  const audio = await renderSoundtrack(DURATION, voices)
  // soft-saturate transients and normalise so nothing clips
  let peak = 0
  for (let ch = 0; ch < 2; ch++) {
    const d = audio.getChannelData(ch)
    for (let i = 0; i < d.length; i++) {
      d[i] = Math.tanh(d[i] * 1.15)
      peak = Math.max(peak, Math.abs(d[i]))
    }
  }
  const norm = 0.95 / Math.max(peak, 1e-6)
  for (let ch = 0; ch < 2; ch++) {
    const d = audio.getChannelData(ch)
    for (let i = 0; i < d.length; i++) d[i] *= norm
  }

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 },
    fastStart: 'in-memory',
  })
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => say('Video error: ' + e.message) })
  venc.configure({ codec: 'avc1.640033', width: W, height: H, bitrate: 10_000_000, framerate: FPS, avc: { format: 'avc' } })
  const aenc = new AudioEncoder({ output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta), error: (e: Error) => say('Audio error: ' + e.message) })
  aenc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 })

  // audio in 1024-frame planar chunks
  const L = audio.getChannelData(0)
  const R = audio.getChannelData(1)
  for (let i = 0; i < audio.length; i += 1024) {
    const n = Math.min(1024, audio.length - i)
    const data = new Float32Array(n * 2)
    data.set(L.subarray(i, i + n), 0)
    data.set(R.subarray(i, i + n), n)
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data })
    aenc.encode(ad)
    ad.close()
  }

  const frames = Math.round(DURATION * FPS)
  const t0 = performance.now()
  for (let f = 0; f < frames; f++) {
    draw(ctx, f / FPS)
    const vf = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) })
    venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 })
    vf.close()
    while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1))
    if (f % 15 === 0) {
      say(`Rendering frame ${f}/${frames} · ${Math.round((performance.now() - t0) / 1000)}s`)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  await venc.flush()
  await aenc.flush()
  muxer.finalize()
  const buf = target.buffer
  say('Saving…')
  const path = await fetch(`/__save?name=${encodeURIComponent(name)}`, { method: 'POST', body: buf }).then((r) => r.text())
  say(`Done: ${path} (${(buf.byteLength / 1e6).toFixed(1)} MB)`)
  return path
}

Object.assign(window, { renderPromo: render, previewPromo: preview })
say('Ready')
