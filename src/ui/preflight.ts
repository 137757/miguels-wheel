/**
 * Preflight.
 *
 * Everything that can be checked before the students arrive is checked before the
 * students arrive. If a config is invalid the app refuses to enter LIVE mode and
 * says exactly what is wrong — it never runs silently on broken rules.
 */

import { validateConfig, ui, type ValidationIssue } from '../config/eventConfig.ts'
import { hasSecureRandom } from '../core/rng.ts'

export interface PreflightRefs {
  screen: HTMLElement
  list: HTMLElement
  testBtn: HTMLButtonElement
  liveBtn: HTMLButtonElement
}

export interface PreflightInput {
  audioReady: boolean
  audioLoaded: number
  audioTotal: number
  audioErrors: string[]
  storageDurable: boolean
  pendingSpin: { prizeLabel: string } | null
  wakeLock: 'active' | 'unsupported' | 'inactive'
  prizes?: import('../config/eventConfig.ts').PrizeDefinition[]
  mystery?: import('../config/eventConfig.ts').MysteryPrizeDefinition[]
}

interface Check {
  label: string
  status: 'ok' | 'warn' | 'bad'
  detail: string
}

function screenCheck(): Check {
  const w = window.innerWidth
  const h = window.innerHeight
  const ratio = w / h
  const status = ratio > 1.7 && ratio < 1.9 ? 'ok' : ratio > 1.4 ? 'warn' : 'bad'
  return {
    label: 'Screen dimensions',
    status,
    detail: `${w}×${h} (${ratio.toFixed(2)}:1)${status === 'ok' ? '' : ' — designed for 16:9, e.g. 1920×1080'}`,
  }
}

export function runPreflight(input: PreflightInput): { checks: Check[]; blocking: boolean; issues: ValidationIssue[] } {
  const issues = validateConfig({ prizes: input.prizes, mystery: input.mystery })
  const configErrors = issues.filter((i) => i.level === 'error')

  const checks: Check[] = []

  checks.push({
    label: 'Prize configuration',
    status: configErrors.length ? 'bad' : issues.length ? 'warn' : 'ok',
    detail: configErrors.length
      ? configErrors.map((i) => i.message).join('; ')
      : issues.length
        ? issues.map((i) => i.message).join('; ')
        : `${'Weights sum to 100. All ids unique. Prices valid.'}`,
  })

  checks.push({
    label: 'Secure randomness',
    status: hasSecureRandom() ? 'ok' : 'bad',
    detail: hasSecureRandom() ? 'window.crypto.getRandomValues available' : 'No CSPRNG — refusing to draw prizes',
  })

  const imageOk = document.images.length === 0 ? true : Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0)
  checks.push({
    label: 'Images loaded',
    status: imageOk ? 'ok' : 'warn',
    detail: imageOk ? 'all textures decoded' : 'some images still decoding',
  })

  const sfxOk = input.audioLoaded >= input.audioTotal && input.audioErrors.length === 0
  checks.push({
    label: 'Sounds decoded',
    status: sfxOk ? 'ok' : input.audioLoaded === 0 ? 'bad' : 'warn',
    detail: sfxOk
      ? `${input.audioTotal}/${input.audioTotal} ready`
      : input.audioErrors.length
        ? input.audioErrors.slice(0, 2).join('; ')
        : `${input.audioLoaded}/${input.audioTotal} ready`,
  })

  checks.push({
    label: 'AudioContext active',
    status: input.audioReady ? 'ok' : 'warn',
    detail: input.audioReady ? 'running' : 'not started — the browser needs a click first',
  })

  checks.push({
    label: 'Local persistence',
    status: input.storageDurable ? 'ok' : 'bad',
    detail: input.storageDurable ? 'localStorage available' : 'storage blocked — a crash would lose the pending prize',
  })

  checks.push(screenCheck())

  const fsAvail = Boolean(document.documentElement.requestFullscreen)
  checks.push({
    label: 'Fullscreen available',
    status: fsAvail ? 'ok' : 'warn',
    detail: fsAvail ? 'supported' : 'not supported in this browser',
  })

  checks.push({
    label: 'Wake lock',
    status: input.wakeLock === 'active' ? 'ok' : input.wakeLock === 'unsupported' ? 'warn' : 'warn',
    detail:
      input.wakeLock === 'active'
        ? 'display will stay awake'
        : input.wakeLock === 'unsupported'
          ? 'not supported — check the display sleep setting manually'
          : 'inactive — will re-acquire on next interaction',
  })

  checks.push({
    label: 'No pending unresolved spin',
    status: input.pendingSpin ? 'warn' : 'ok',
    detail: input.pendingSpin ? `A prize is already drawn: ${input.pendingSpin.prizeLabel}` : 'clean',
  })

  const blocking = configErrors.length > 0 || !hasSecureRandom() || !input.storageDurable
  return { checks, blocking, issues }
}

export class PreflightScreen {
  #refs: PreflightRefs
  #blocking = false

  constructor(refs: PreflightRefs) {
    this.#refs = refs
  }

  render(input: PreflightInput): boolean {
    const { checks, blocking } = runPreflight(input)
    this.#blocking = blocking
    this.#refs.screen.hidden = false
    this.#refs.screen.classList.add('is-active')
    this.#refs.list.innerHTML = checks
      .map(
        (c) => `
      <li class="check check--${c.status}">
        <span class="check__box">${c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✕'}</span>
        <span>${c.label}</span>
        <span class="check__detail">${c.detail}</span>
      </li>`,
      )
      .join('')
    this.#refs.liveBtn.disabled = blocking
    this.#refs.liveBtn.textContent = blocking ? 'BLOCKED — SEE ABOVE' : 'ENTER LIVE MODE'
    return !blocking
  }

  get isBlocking(): boolean {
    return this.#blocking
  }

  hide(): void {
    this.#refs.screen.hidden = true
    this.#refs.screen.classList.remove('is-active')
  }
}

export const storageKeyLabel = ui.storageKey
