// Paddle "pop" detection. A paddle strike is a short, loud, bright transient,
// so we high-pass the signal and look for energy spikes far above the local level.

export async function decodeAudio(file: Blob): Promise<{ data: Float32Array; rate: number } | null> {
  if (file.size > 1.5e9) return null
  try {
    const buf = await file.arrayBuffer()
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const audio = await ctx.decodeAudioData(buf)
    ctx.close()
    const ch0 = audio.getChannelData(0)
    if (audio.numberOfChannels > 1) {
      const ch1 = audio.getChannelData(1)
      const mono = new Float32Array(ch0.length)
      for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5
      return { data: mono, rate: audio.sampleRate }
    }
    return { data: ch0, rate: audio.sampleRate }
  } catch {
    return null
  }
}

export interface Onset {
  t: number
  strength: number
}

export function detectPops(data: Float32Array, rate: number): Onset[] {
  const hop = Math.round(rate * 0.005)
  const n = Math.floor(data.length / hop)
  const env = new Float32Array(n)
  let prev = 0
  for (let f = 0; f < n; f++) {
    let e = 0
    const base = f * hop
    for (let i = 0; i < hop; i++) {
      const x = data[base + i]
      const hp = x - prev // first difference emphasises high frequencies
      prev = x
      e += hp * hp
    }
    env[f] = Math.sqrt(e / hop)
  }
  // global floor from the 97th percentile, so quiet recordings still work
  const sorted = Float32Array.from(env).sort()
  const p97 = sorted[Math.floor(sorted.length * 0.97)] || 1e-6
  const floor = p97 * 0.6
  const win = Math.round(0.4 / 0.005)
  const out: Onset[] = []
  let sum = 0
  for (let f = 0; f < Math.min(win, n); f++) sum += env[f]
  let last = -1
  for (let f = 1; f < n - 1; f++) {
    if (f >= win) sum += env[f] - env[f - win]
    const local = sum / Math.min(win, f + 1)
    const v = env[f]
    if (v < floor || v < local * 5) continue
    if (v < env[f - 1] || v < env[f + 1]) continue
    const t = (f * hop) / rate
    if (last >= 0 && t - out[last].t < 0.22) {
      if (v > out[last].strength) out[last] = { t, strength: v }
      continue
    }
    out.push({ t, strength: v })
    last = out.length - 1
  }
  return out
}
