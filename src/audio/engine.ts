/**
 * Audio engine.
 *
 * Two jobs:
 *  1. Load and play the curated local SFX set.
 *  2. Synthesise the pointer "tick" in Web Audio so the tick can be fired at the
 *     exact frame a sector boundary passes the pointer. A timer-driven sample loop
 *     would drift against the wheel and sound wrong the moment it slowed down.
 */

import { audioVolumes, sfxPaths, type SfxName } from '../config/eventConfig.ts'

interface Loaded {
  buffer: AudioBuffer
}

export type DuckAmount = { amount: number; seconds: number }

export class AudioEngine {
  #ctx: AudioContext | null = null
  #master: GainNode | null = null
  #sfxBus: GainNode | null = null
  #buffers = new Map<SfxName, Loaded>()
  #muted = false
  #pendingLoads: Promise<void>[] = []
  #tickLimitAt = 0
  readonly loadErrors: string[] = []

  constructor(private readonly basePath = '') {}

  get ready(): boolean {
    return this.#ctx !== null && this.#ctx.state === 'running'
  }

  get contextState(): AudioContextState | 'uninitialised' {
    return this.#ctx?.state ?? 'uninitialised'
  }

  get sampleRate(): number {
    return this.#ctx?.sampleRate ?? 48000
  }

  get loadedCount(): number {
    return this.#buffers.size
  }

  get isMuted(): boolean {
    return this.#muted
  }

  /** Must be called from a user gesture (the START EVENT click). */
  async init(): Promise<void> {
    if (this.#ctx) {
      if (this.#ctx.state === 'suspended') await this.#ctx.resume()
      return
    }
    const Ctor =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) throw new Error('Web Audio is not available in this browser')
    this.#ctx = new Ctor({ latencyHint: 'interactive' })
    this.#master = this.#ctx.createGain()
    this.#master.gain.value = this.#muted ? 0 : audioVolumes.master
    this.#master.connect(this.#ctx.destination)

    this.#sfxBus = this.#ctx.createGain()
    this.#sfxBus.gain.value = 1
    this.#sfxBus.connect(this.#master)

    if (this.#ctx.state === 'suspended') await this.#ctx.resume()
  }

  async loadAll(): Promise<boolean> {
    const names = Object.keys(sfxPaths) as SfxName[]
    this.#pendingLoads = names.map((name) => this.#load(name))
    await Promise.all(this.#pendingLoads)
    this.#pendingLoads = []
    return this.loadErrors.length === 0
  }

  async #load(name: SfxName): Promise<void> {
    if (!this.#ctx) return
    try {
      const res = await fetch(`${this.basePath}${sfxPaths[name]}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = await res.arrayBuffer()
      const buffer = await this.#ctx.decodeAudioData(bytes)
      this.#buffers.set(name, { buffer })
    } catch (err) {
      this.loadErrors.push(`${name}: ${String(err)}`)
    }
  }

  get allLoaded(): boolean {
    return this.loadErrors.length === 0 && this.#buffers.size === Object.keys(sfxPaths).length
  }

  setMuted(m: boolean): void {
    this.#muted = m
    if (this.#ctx && this.#master) {
      const t = this.#ctx.currentTime
      this.#master.gain.cancelScheduledValues(t)
      this.#master.gain.setTargetAtTime(m ? 0 : audioVolumes.master, t, 0.03)
    }
  }

  /**
   * Play a loaded SFX.
   * `when` and `offset` let a reveal schedule several stingers on one timeline.
   */
  play(
    name: SfxName,
    opts: { volume?: number; rate?: number; when?: number; delay?: number } = {},
  ): AudioBufferSourceNode | null {
    if (!this.#ctx || !this.#sfxBus || this.#muted) return null
    const entry = this.#buffers.get(name)
    if (!entry) return null

    const t0 = this.#ctx.currentTime + (opts.delay ?? 0) + (opts.when ?? 0)
    const src = this.#ctx.createBufferSource()
    src.buffer = entry.buffer
    src.playbackRate.value = opts.rate ?? 1

    const gain = this.#ctx.createGain()
    const vol = (opts.volume ?? 1) * (audioVolumes.sfx[name] ?? 1)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.008)
    // Short tails keep stings from clicking on stop.
    gain.gain.setValueAtTime(Math.max(0.0002, vol), t0 + Math.min(0.25, entry.buffer.duration - 0.02))
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(entry.buffer.duration, 1.4))

    src.connect(gain).connect(this.#sfxBus)
    src.start(t0)
    src.stop(t0 + Math.min(entry.buffer.duration + 0.1, 1.6))
    return src
  }

  /** Schedule a sequence of stings on one timeline. */
  playSequence(steps: { name: SfxName; at: number; volume?: number; rate?: number }[]): void {
    for (const s of steps) this.play(s.name, { when: s.at, volume: s.volume, rate: s.rate })
  }

  /** Momentarily pull the mix down so a reveal can breathe. */
  duck(amount: number, seconds: number): DuckAmount {
    if (!this.#ctx || !this.#master) return { amount: 0, seconds: 0 }
    const t = this.#ctx.currentTime
    const g = this.#master.gain
    const floor = this.#muted ? 0 : audioVolumes.master * amount
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(floor, t + 0.12)
    g.setValueAtTime(floor, t + seconds)
    return { amount, seconds }
  }

  unduck(after: number): void {
    if (!this.#ctx || !this.#master) return
    const t = this.#ctx.currentTime + after
    const g = this.#master.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(this.#muted ? 0 : audioVolumes.master, t + 0.25)
  }

  /**
   * The pointer tick.
   *
   * A short filtered noise burst plus a pitched click. `intensity` (0..1) tracks
   * angular speed so the tick thins out and brightens as the wheel slows, which is
   * what makes the deceleration legible to a listener who is watching the wheel
   * from four metres away.
   */
  tick(intensity: number): void {
    if (!this.#ctx || !this.#sfxBus || this.#muted) return
    const ctx = this.#ctx
    const i = Math.max(0, Math.min(1, intensity))
    const t = ctx.currentTime

    // Rate limit: above ~55 ticks/sec it stops sounding like ticks.
    if (t < this.#tickLimitAt) return
    this.#tickLimitAt = t + (i > 0.62 ? 0.016 : 0.028)

    const level = 0.16 + 0.34 * (1 - i)
    const dest = this.#sfxBus

    // Click body: a fast-decaying triangle at a pitch that rises as it slows.
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    const basePitch = 1150 + (1 - i) * 780
    osc.frequency.setValueAtTime(basePitch * 1.5, t)
    osc.frequency.exponentialRampToValueAtTime(basePitch, t + 0.012)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t)
    og.gain.exponentialRampToValueAtTime(level, t + 0.002)
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
    osc.connect(og).connect(dest)
    osc.start(t)
    osc.stop(t + 0.06)

    // Transient: band-passed noise for the wooden "tok".
    const dur = 0.03
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let n = 0; n < data.length; n++) {
      data[n] = (Math.random() * 2 - 1) * (1 - n / data.length) ** 2
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2100 + (1 - i) * 1200
    bp.Q.value = 1.6
    const ng = ctx.createGain()
    ng.gain.value = level * 0.75
    noise.connect(bp).connect(ng).connect(dest)
    noise.start(t)
  }

  /** Low sine "thud" for the SPIN button press. */
  thump(freq = 92, duration = 0.22, level = 0.5): void {
    if (!this.#ctx || !this.#sfxBus || this.#muted) return
    const ctx = this.#ctx
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * 1.9, t)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + duration)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(g).connect(this.#sfxBus)
    osc.start(t)
    osc.stop(t + duration + 0.02)
  }

  dispose(): void {
    this.#ctx?.close().catch(() => undefined)
    this.#ctx = null
  }
}

export const audio = new AudioEngine(import.meta.env?.BASE_URL ?? '')
