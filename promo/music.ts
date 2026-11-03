// Original soundtrack for the promo, synthesised offline: 128 BPM electronic track,
// sound effects on the cuts, and the voiceover mixed on top with music ducking.

export const BPM = 128
export const BEAT = 60 / BPM
export const BAR = BEAT * 4
export const DROP = BAR * 2 // 3.75s: first drop, synced with the logo slam
export const BREAK = 26.05 // silence before "Stop guessing"
export const FINAL = 28.6 // final section / CTA

export interface VoiceCue {
  id: string
  at: number
  dur: number
}

const RATE = 48000

function noiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate)
  const d = b.getChannelData(0)
  let s = 1234567
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    d[i] = (s / 0x7fffffff) * 2 - 1
  }
  return b
}

function reverbImpulse(ctx: BaseAudioContext, seconds: number) {
  const b = ctx.createBuffer(2, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    let s = 99 + c
    for (let i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      d[i] = ((s / 0x7fffffff) * 2 - 1) * Math.pow(1 - i / d.length, 3)
    }
  }
  return b
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

// Am – F – C – G
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
]
const ROOTS = [33, 29, 36, 31]

export async function renderSoundtrack(duration: number, voices: { cue: VoiceCue; buffer: AudioBuffer }[]) {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * RATE), RATE)
  const noise = noiseBuffer(ctx, 2)

  const master = ctx.createDynamicsCompressor()
  master.threshold.value = -14
  master.ratio.value = 4
  master.attack.value = 0.005
  master.release.value = 0.2
  const masterGain = ctx.createGain()
  masterGain.gain.value = 0.95
  master.connect(masterGain).connect(ctx.destination)

  const music = ctx.createGain()
  music.connect(master)
  const reverb = ctx.createConvolver()
  reverb.buffer = reverbImpulse(ctx, 2.4)
  const revGain = ctx.createGain()
  revGain.gain.value = 0.25
  reverb.connect(revGain).connect(music)

  // duck the music under every voice line
  music.gain.setValueAtTime(1, 0)
  for (const { cue } of voices) {
    music.gain.setTargetAtTime(0.42, Math.max(0, cue.at - 0.08), 0.04)
    music.gain.setTargetAtTime(1, cue.at + cue.dur + 0.05, 0.12)
  }
  // fade out
  music.gain.setTargetAtTime(0, duration - 1.6, 0.4)

  // sidechain bus: everything pumped by the kick
  const pump = ctx.createGain()
  pump.connect(music)
  pump.connect(reverb)

  const inBreak = (t: number) => t >= BREAK && t < BREAK + BEAT * 1.1
  const playing = (t: number) => t >= DROP && !inBreak(t) && t < duration - 1.2

  // ---- instruments ----
  const kick = (t: number, gain = 1) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.setValueAtTime(160, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
    o.connect(g).connect(music)
    o.start(t)
    o.stop(t + 0.5)
    pump.gain.setValueAtTime(0.25, t)
    pump.gain.linearRampToValueAtTime(1, t + BEAT * 0.85)
  }
  const noiseHit = (t: number, dur: number, type: BiquadFilterType, freq: number, gain: number, dest: AudioNode = music, q = 1) => {
    const s = ctx.createBufferSource()
    s.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    s.connect(f).connect(g).connect(dest)
    s.start(t, Math.random() * 1)
    s.stop(t + dur + 0.02)
  }
  const clap = (t: number) => {
    for (let i = 0; i < 3; i++) noiseHit(t + i * 0.012, 0.18, 'bandpass', 1500, 0.55, music, 0.8)
    noiseHit(t, 0.4, 'bandpass', 1800, 0.25, reverb, 0.7)
  }
  const hat = (t: number, gain = 0.16) => noiseHit(t, 0.045, 'highpass', 8500, gain)
  const synth = (t: number, freq: number, dur: number, type: OscillatorType, gain: number, cutoff: number, dest: AudioNode, attack = 0.005) => {
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(cutoff, t)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain, t + attack)
    g.gain.setTargetAtTime(0.0001, t + dur * 0.7, dur * 0.25)
    f.connect(g).connect(dest)
    for (const det of type === 'sawtooth' ? [-9, 0, 9] : [0]) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = freq
      o.detune.value = det
      o.connect(f)
      o.start(t)
      o.stop(t + dur + 0.3)
    }
  }
  const riser = (t0: number, t1: number, gain = 0.35) => {
    const s = ctx.createBufferSource()
    s.buffer = noise
    s.loop = true
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 2
    f.frequency.setValueAtTime(300, t0)
    f.frequency.exponentialRampToValueAtTime(7000, t1)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t1)
    g.gain.linearRampToValueAtTime(0, t1 + 0.02)
    s.connect(f).connect(g).connect(music)
    s.start(t0)
    s.stop(t1 + 0.05)
  }
  const whoosh = (t: number, gain = 0.3) => {
    const s = ctx.createBufferSource()
    s.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.5
    f.frequency.setValueAtTime(400, t)
    f.frequency.exponentialRampToValueAtTime(4000, t + 0.35)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.2)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    s.connect(f).connect(g).connect(master)
    s.start(t)
    s.stop(t + 0.55)
  }
  const impact = (t: number, gain = 0.9) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.setValueAtTime(90, t)
    o.frequency.exponentialRampToValueAtTime(28, t + 0.8)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4)
    o.connect(g).connect(master)
    o.start(t)
    o.stop(t + 1.5)
    noiseHit(t, 0.6, 'lowpass', 2500, 0.5, master)
    noiseHit(t, 1.6, 'lowpass', 1200, 0.3, reverb)
  }
  const pop = (t: number, gain = 0.6) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.setValueAtTime(1400, t)
    o.frequency.exponentialRampToValueAtTime(700, t + 0.03)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    o.connect(g).connect(master)
    o.start(t)
    o.stop(t + 0.08)
    noiseHit(t, 0.03, 'highpass', 2500, gain * 0.6, master)
  }
  const tick = (t: number, f = 2200, gain = 0.25) => {
    const o = ctx.createOscillator()
    o.type = 'triangle'
    const g = ctx.createGain()
    o.frequency.value = f
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
    o.connect(g).connect(master)
    o.start(t)
    o.stop(t + 0.1)
  }

  // ---- arrangement ----
  // intro: low drone, heartbeat, tension
  synth(0, midi(33), DROP + 0.2, 'sawtooth', 0.12, 180, music, 0.8)
  for (let b = 0; b < 2; b++) {
    kick(b * BAR, 0.5)
    kick(b * BAR + BEAT * 0.5, 0.3)
  }
  pop(0.15, 0.8)
  pop(0.95, 0.5)
  riser(DROP - BAR * 0.9, DROP, 0.4)

  const end = duration - 1.2
  for (let t = DROP, step = 0; t < end; t += BEAT / 2, step++) {
    const beatIdx = Math.floor(step / 2)
    const bar = Math.floor((t - DROP) / BAR)
    const chord = bar % 4
    if (!playing(t)) continue
    const onBeat = step % 2 === 0
    const final = t >= FINAL
    if (onBeat) kick(t, final ? 1 : 0.95)
    if (onBeat && beatIdx % 2 === 1) clap(t)
    hat(t, onBeat ? 0.08 : 0.17)
    if (final || bar % 2 === 1) hat(t + BEAT / 4, 0.09)
    // offbeat bass
    if (!onBeat) synth(t, midi(ROOTS[chord] + 12), BEAT * 0.45, 'sawtooth', 0.22, 600, pump)
    // pluck arp, 16ths
    const arp = CHORDS[chord]
    for (let k = 0; k < 2; k++) {
      const n = arp[(step * 2 + k) % 3] + 12 + (final && k === 1 ? 12 : 0)
      synth(t + (k * BEAT) / 4, midi(n), 0.16, 'square', 0.035, 2600, pump)
    }
    // pads on each bar
    if (step % 8 === 0) {
      for (const n of CHORDS[chord]) synth(t, midi(n), BAR, 'sawtooth', 0.045, 1400, pump, 0.25)
    }
  }
  // break and re-entry
  riser(BREAK - BAR * 0.75, BREAK, 0.45)
  impact(BREAK + BEAT * 1.1 + 0.25, 1)
  impact(DROP, 1)
  impact(FINAL, 0.9)

  // transitions and UI sound design (times match the visual timeline)
  for (const t of [7.75, 12.95, 16.75, 19.25, 23.15, 28.55]) whoosh(t - 0.15)
  for (let i = 0; i < 8; i++) tick(13.35 + i * 0.16, 1800 + i * 160)
  pop(15.3, 0.7) // "brilliant"
  impact(16.05, 0.5) // "blunder"
  for (const t of [19.6, 20.45, 21.1, 21.75]) pop(t, 0.45)
  tick(24.3, 2600, 0.3)
  tick(25.1, 3000, 0.3)

  // ---- voice ----
  const vbus = ctx.createGain()
  vbus.gain.value = 1.35
  const vcomp = ctx.createDynamicsCompressor()
  vcomp.threshold.value = -20
  vcomp.ratio.value = 3
  const presence = ctx.createBiquadFilter()
  presence.type = 'peaking'
  presence.frequency.value = 3200
  presence.gain.value = 4
  const vrev = ctx.createGain()
  vrev.gain.value = 0.12
  vbus.connect(presence).connect(vcomp).connect(master)
  vcomp.connect(vrev).connect(reverb)
  for (const { cue, buffer } of voices) {
    const s = ctx.createBufferSource()
    s.buffer = buffer
    s.connect(vbus)
    s.start(cue.at)
  }

  return ctx.startRendering()
}
