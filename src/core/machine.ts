/**
 * Strict state machine.
 *
 * A spin may ONLY start from ARMED or BONUS_ARMED. Every other state makes the
 * public SPIN control inert, which is what stops a mashed button or an impatient
 * double-click from minting a second prize.
 */

export const STATES = [
  'BOOT',
  'START',
  'PREFLIGHT',
  'IDLE',
  'ARMED',
  'BONUS_ARMED',
  'SPINNING',
  'REVEAL',
  'AWAITING_REDEMPTION',
  'ERROR_RECOVERY',
] as const

export type State = (typeof STATES)[number]

const SPIN_ORIGINS: State[] = ['ARMED', 'BONUS_ARMED']

/** Legal transitions. Anything not listed here is refused. */
const ALLOWED: Record<State, State[]> = {
  BOOT: ['START', 'PREFLIGHT', 'ERROR_RECOVERY'],
  START: ['PREFLIGHT', 'IDLE', 'ERROR_RECOVERY'],
  PREFLIGHT: ['IDLE', 'START', 'ERROR_RECOVERY'],
  IDLE: ['ARMED', 'PREFLIGHT', 'ERROR_RECOVERY'],
  ARMED: ['SPINNING', 'IDLE', 'ERROR_RECOVERY'],
  BONUS_ARMED: ['SPINNING', 'IDLE', 'REVEAL', 'ERROR_RECOVERY'],
  SPINNING: ['REVEAL', 'AWAITING_REDEMPTION', 'ERROR_RECOVERY'],
  REVEAL: ['AWAITING_REDEMPTION', 'SPINNING', 'IDLE', 'ERROR_RECOVERY'],
  AWAITING_REDEMPTION: ['IDLE', 'BONUS_ARMED', 'ARMED', 'ERROR_RECOVERY'],
  ERROR_RECOVERY: ['IDLE', 'PREFLIGHT', 'AWAITING_REDEMPTION', 'ERROR_RECOVERY'],
}

export function canTransition(from: State, to: State): boolean {
  return ALLOWED[from].includes(to)
}

export function isSpinOrigin(state: State): boolean {
  return SPIN_ORIGINS.includes(state)
}

export interface MachineSnapshot {
  state: State
  /** Monotonic counter, useful for detecting double-entry in tests. */
  transitionCount: number
}

type Listener = (from: State, to: State) => void

export class WheelMachine {
  #state: State = 'BOOT'
  #transitions = 0
  #listeners = new Set<Listener>()

  get state(): State {
    return this.#state
  }

  get transitionCount(): number {
    return this.#transitions
  }

  get canSpin(): boolean {
    return isSpinOrigin(this.#state)
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  /** Returns true when the transition was accepted. */
  go(to: State): boolean {
    if (to === this.#state) return false
    if (!canTransition(this.#state, to)) {
      throw new Error(`Illegal state transition ${this.#state} -> ${to}`)
    }
    const from = this.#state
    this.#state = to
    this.#transitions += 1
    for (const fn of this.#listeners) fn(from, to)
    return true
  }

  /** Force a state without a guard — used only by recovery after a reload. */
  restore(to: State): void {
    const from = this.#state
    this.#state = to
    for (const fn of this.#listeners) fn(from, to)
  }

  /**
   * Atomic claim of the spin right. This is the single point that guarantees a
   * duplicate click cannot produce a second prize: whoever wins the claim sets
   * SPINNING synchronously, and the loser is rejected.
   */
  claimSpin(): boolean {
    if (!this.canSpin) return false
    return this.go('SPINNING')
  }
}
