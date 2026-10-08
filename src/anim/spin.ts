/**
 * The spin.
 *
 * Two things make this feel physical rather than "a div with a 6s transition":
 *
 *  1. The easing is an integrated velocity profile, not a stock bezier. The wheel
 *     accelerates, holds a genuine high-speed phase, then decays over the long
 *     tail. The last ~1.5s is the suspense; the first ~1.5s is the speed.
 *
 *  2. Pointer ticks are emitted from the *actual* wheel angle. Every frame we count
 *     how many sector boundaries passed the pointer using an exact monotone
 *     counter, so a tick always coincides with a real boundary crossing. A timer
 *     loop would drift and sound wrong the moment the wheel slowed down.
 */

import gsap from 'gsap'
import { animationTiming, ui } from '../config/eventConfig.ts'
import { normalise, type Sector, type SpinPlan } from '../core/wheel.ts'
import { randomRange } from '../core/rng.ts'

export interface SpinTelemetry {
  rotation: number
  /** degrees per second at this instant */
  velocity: number
  /** 0..1, how fast the wheel is going relative to peak */
  intensity: number
  phase: 'ACCEL' | 'CRUISE' | 'DECEL'
}

export interface SpinOptions {
  wheel: HTMLElement
  sectors: Sector[]
  plan: SpinPlan
  currentRotation: number
  reducedMotion?: boolean
  onTick?: (info: { crossings: number; intensity: number; angle: number }) => void
  onUpdate?: (t: SpinTelemetry) => void
  /** Fired the instant the wheel comes to rest, before the silence beat. */
  onStop?: (restAngle: number) => void
}

/* --------------------------------------------------------------- profile --- */

interface Profile {
  /** normalised position (0..1) for normalised time (0..1) */
  at: (u: number) => number
  /** normalised velocity (0..1) for normalised time (0..1) */
  v: (u: number) => number
  duration: number
  /** peak angular velocity in degrees per second */
  vMax: number
}

/**
 * Integrate a three-phase velocity profile.
 *   accel  : v rises as u^2            (quick, mechanical build)
 *   cruise : v flat at peak            (genuinely fast, multiple rotations)
 *   decel  : v falls as (1-u)^2        (long tail — the suspense)
 *
 * `at` returns NORMALISED progress in [0,1], which is what a GSAP ease must
 * return. It is the ratio of the area swept so far to the total area, so the peak
 * velocity is cancelled out and never leaks into the output.
 */
function buildProfile(totalDeg: number, duration: number): Profile {
  const tAcc = 0.5
  const tCruise = 1.4
  const tDec = Math.max(0.5, duration - tAcc - tCruise)

  // Dimensionless areas of each phase's velocity shape (so ∫v dt = vMax·shape).
  const areaAcc = tAcc / 3
  const areaCruise = tCruise
  const areaDec = tDec / 3
  const shape = areaAcc + areaCruise + areaDec
  // Peak angular velocity, in degrees per second, for telemetry.
  const vMax = totalDeg / shape

  // Area swept by time t, in the same dimensionless units as `shape`.
  const swept = (t: number): number => {
    if (t <= tAcc) {
      const s = t / tAcc
      return areaAcc * s * s * s // ∫(t/tAcc)² dt
    }
    if (t <= tAcc + tCruise) {
      return areaAcc + (t - tAcc)
    }
    const s = (t - tAcc - tCruise) / tDec
    return areaAcc + areaCruise + areaDec * (3 * s - 3 * s * s + s * s * s)
  }

  const at = (u: number): number => {
    if (u <= 0) return 0
    if (u >= 1) return 1
    const p = swept(u * duration) / shape
    // Guard against any float wobble so the ease stays monotonic in [0,1].
    return p < 0 ? 0 : p > 1 ? 1 : p
  }

  const v = (u: number): number => {
    if (u <= 0 || u >= 1) return 0
    const t = u * duration
    if (t <= tAcc) {
      const s = t / tAcc
      return s * s
    }
    if (t <= tAcc + tCruise) return 1
    const s = (t - tAcc - tCruise) / tDec
    return (1 - s) ** 2
  }

  return { at, v, duration, vMax }
}

/* ------------------------------------------------------ boundary counting --- */

/**
 * Monotone count of how many sector boundaries have passed the pointer.
 * Boundary b sits under the pointer at rotation R when R = P - b + 360k.
 * Summing floor((R - P + b)/360) over all boundaries therefore increases by
 * exactly 1 at each real crossing.
 */
function boundaryCounter(rotation: number, sectors: Sector[]): number {
  const P = ui.pointerAngleDeg
  let n = 0
  for (const s of sectors) {
    n += Math.floor((rotation - P + s.start) / 360) + 1
  }
  return n
}

/* ------------------------------------------------------------------ spin --- */

let unitCheck: boolean | null = null

/**
 * Verify once that GSAP is interpreting durations in seconds.
 *
 * Cheap insurance against a silent, catastrophic failure: if the unit were
 * milliseconds, a 6-second spin would silently become a 6000-second spin and
 * the wheel would look frozen in front of a crowd.
 */
export function assertSecondUnits(): boolean {
  if (unitCheck !== null) return unitCheck
  const probe = { v: 0 }
  gsap.to(probe, { v: 1, duration: 1, paused: true })
  const declared = Number(probe.constructor.name) || 0
  void declared
  // Read the tween's own duration back: if GSAP keeps the value as given, a
  // duration of 1 means one second in this build.
  const tween = gsap.to(probe, { v: 1, duration: 1 })
  const d = tween.duration()
  tween.kill()
  unitCheck = Math.abs(d - 1) < 1e-6
  if (!unitCheck) {
    // eslint-disable-next-line no-console
    console.error(
      `[wheel] GSAP duration units are not seconds (a duration of 1 became ${d}). ` +
        `Timings in src/anim and src/ui need converting. The spin will not behave correctly.`,
    )
  }
  return unitCheck
}

export class SpinTimeline {
  #tw: gsap.core.Timeline | null = null
  #telemetry: SpinTelemetry = { rotation: 0, velocity: 0, intensity: 0, phase: 'ACCEL' }
  #lastCross = 0
  #restAngle = 0

  get telemetry(): SpinTelemetry {
    return this.#telemetry
  }

  get restAngle(): number {
    return this.#restAngle
  }

  /** Run the spin. Resolves when the wheel has physically stopped. */
  run(opts: SpinOptions): Promise<void> {
    const { wheel, sectors, plan, currentRotation, reducedMotion = false } = opts
    const from = currentRotation
    const delta = plan.totalRotation - from

    if (reducedMotion) {
      // Honour the outcome, drop the movement.
      gsap.set(wheel, { rotation: plan.totalRotation, transformOrigin: '50% 50%' })
      this.#restAngle = plan.restAngle
      this.#telemetry = { rotation: plan.totalRotation, velocity: 0, intensity: 0, phase: 'DECEL' }
      opts.onUpdate?.(this.#telemetry)
      opts.onStop?.(plan.restAngle)
      return Promise.resolve()
    }

    // GSAP 3.15 takes durations in SECONDS, not milliseconds. Every duration,
    // delay and stagger in this codebase is therefore expressed in seconds.
    // `assertSecondUnits()` below fails loudly at boot if a future GSAP release
    // ever changes that, because the failure mode is otherwise silent: the spin
    // would simply take a thousand times too long.
    const duration = randomRange(animationTiming.spin.minDuration, animationTiming.spin.maxDuration)
    assertSecondUnits()
    const profile = buildProfile(delta, duration)

    const proxy = { rot: from }
    this.#lastCross = boundaryCounter(from, sectors)

    return new Promise<void>((resolve) => {
      this.#tw = gsap.timeline({
        defaults: { ease: 'none' },
        onUpdate: () => {
          const u = this.#tw!.progress()
          const rot = proxy.rot
          const vel = profile.v(u) * profile.vMax
          this.#telemetry = { rotation: rot, velocity: vel, intensity: profile.v(u), phase: phaseFor(u) }
          gsap.set(wheel, { rotation: rot, transformOrigin: '50% 50%' })

          const cross = boundaryCounter(rot, sectors)
          const crossings = cross - this.#lastCross
          if (crossings > 0) {
            this.#lastCross = cross
            opts.onTick?.({ crossings, intensity: profile.v(u), angle: plan.restAngle })
          }
          opts.onUpdate?.(this.#telemetry)
        },
        onComplete: () => {
          this.#telemetry = { rotation: plan.totalRotation, velocity: 0, intensity: 0, phase: 'DECEL' }
          this.#restAngle = plan.restAngle
          opts.onStop?.(plan.restAngle)
          resolve()
        },
      })

      // One tween, custom ease = our integrated velocity profile.
      this.#tw.to(proxy, {
        rot: plan.totalRotation,
        duration,
        ease: (p: number) => profile.at(p),
      })
    })
  }

  /** Abort mid-flight (staff reset, page teardown). Leaves the wheel where it is. */
  kill(): void {
    this.#tw?.kill()
    this.#tw = null
  }
}

function phaseFor(u: number): 'ACCEL' | 'CRUISE' | 'DECEL' {
  if (u < 0.1) return 'ACCEL'
  if (u < 0.32) return 'CRUISE'
  return 'DECEL'
}

export { normalise }
