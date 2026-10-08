/**
 * Inline SVG artwork.
 *
 * Everything here is drawn from scratch in code — no traced or copied character.
 * Icons are sized for a wheel sector: bold, single-colour, readable at 3–5 m.
 */

import { colours } from '../config/eventConfig.ts'

const { gold, cream, red, pink, ink } = colours

export type IconName =
  | 'sauce'
  | 'cup'
  | 'fries'
  | 'ticket'
  | 'drumstick'
  | 'gift'
  | 'half'
  | 'crown'

/**
 * Icons render in a 100×100 box centred on the origin.
 *
 * The body is returned WITHOUT an `<svg>` wrapper so the caller can inject it as
 * a nested `<svg>` element. That matters for performance: wrapping SVG in a
 * `<foreignObject>` (the obvious approach) forces a full HTML layout inside the
 * wheel on every animation frame, which drops the frame rate far enough for GSAP
 * to start clamping time and makes tweens crawl.
 */
function frame(inner: string): IconBody {
  return { viewBox: '-50 -50 100 100', body: inner }
}

export interface IconBody {
  viewBox: string
  body: string
}

const ICONS: Record<IconName, IconBody> = {
  /* Extra Seoul Fire / Snow Cheese seasoning */
  sauce: frame(`
    <path d="M-16 -34 L16 -34 L13 -6 L-13 -6 Z" fill="${cream}" opacity=".92"/>
    <path d="M-13 -6 L13 -6 L16 30 L-16 30 Z" fill="${red}"/>
    <rect x="-19" y="-40" width="38" height="8" rx="3" fill="${gold}"/>
    <path d="M-8 4 q8 6 16 0 M-8 16 q8 6 16 0" stroke="${cream}" stroke-width="3.4" fill="none" stroke-linecap="round" opacity=".85"/>
    <circle cx="20" cy="-14" r="4.4" fill="${gold}" opacity=".9"/>
    <circle cx="25" cy="-3" r="2.8" fill="${gold}" opacity=".7"/>
  `),

  /* Seoul Sunset strawberry-raspberry ade */
  cup: frame(`
    <path d="M-25 -30 L25 -30 L18 34 L-18 34 Z" fill="${cream}" opacity=".95"/>
    <path d="M-23 -22 L23 -22 L20 8 L-20 8 Z" fill="${pink}"/>
    <path d="M-20 8 L20 8 L18 34 L-18 34 Z" fill="${pink}" opacity=".55"/>
    <rect x="-29" y="-36" width="58" height="7" rx="3" fill="${gold}"/>
    <path d="M22 -30 L40 -40" stroke="${gold}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="6" cy="-3" r="4" fill="${cream}" opacity=".9"/>
    <circle cx="-6" cy="0" r="3" fill="${cream}" opacity=".75"/>
    <circle cx="1" cy="-11" r="2.6" fill="${cream}" opacity=".8"/>
  `),

  /* Seoul Fries */
  fries: frame(`
    <path d="M-26 -14 L26 -14 L20 34 L-20 34 Z" fill="${red}"/>
    <path d="M-24 -8 L24 -8 L22 8 L-22 8 Z" fill="${cream}" opacity=".92"/>
    <g stroke="${gold}" stroke-width="9" stroke-linecap="round">
      <path d="M-15 -14 L-18 -42"/>
      <path d="M-5 -14 L-6 -46"/>
      <path d="M6 -14 L7 -45"/>
      <path d="M15 -14 L19 -39"/>
    </g>
    <path d="M-16 20 h32" stroke="${cream}" stroke-width="3.4" opacity=".7" stroke-linecap="round"/>
  `),

  /* $2 off — a price tag. The amount lives in the sector text, not in the icon. */
  ticket: frame(`
    <path d="M-30 -22 h44 l16 22 l-16 22 h-44 a6 6 0 0 1 -6 -6 v-32 a6 6 0 0 1 6 -6 Z" fill="${cream}"/>
    <path d="M-30 -22 h44 l16 22 l-16 22 h-44 Z" fill="${red}" opacity=".18"/>
    <circle cx="-14" cy="0" r="6" fill="${ink}" opacity=".65"/>
    <text x="8" y="13" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="32" fill="${red}">$</text>
  `),

  /* Extra chicken piece */
  drumstick: frame(`
    <path d="M-20 22 q-16 -14 -4 -30 q10 -14 26 -12 q20 3 22 22 q2 20 -18 26 q-14 4 -26 -6 Z" fill="${cream}"/>
    <path d="M18 12 L40 34" stroke="${cream}" stroke-width="11" stroke-linecap="round"/>
    <path d="M18 12 L40 34" stroke="${ink}" stroke-width="2" stroke-linecap="round" opacity=".3"/>
    <path d="M-14 2 q10 -8 22 -4" stroke="${red}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".85"/>
    <path d="M-16 12 q10 -6 20 -3" stroke="${red}" stroke-width="3.4" fill="none" stroke-linecap="round" opacity=".7"/>
  `),

  /* Mystery box */
  gift: frame(`
    <path d="M-28 -8 L28 -8 L22 30 L-22 30 Z" fill="${red}"/>
    <rect x="-31" y="-20" width="62" height="15" rx="3" fill="${cream}"/>
    <rect x="-6" y="-20" width="12" height="50" fill="${cream}"/>
    <path d="M0 -20 q-16 -2 -16 -12 q0 -8 8 -8 q8 0 8 20 Z" fill="${gold}"/>
    <path d="M0 -20 q16 -2 16 -12 q0 -8 -8 -8 q-8 0 -8 20 Z" fill="${gold}"/>
    <text x="0" y="12" text-anchor="middle" font-family="Anton, sans-serif" font-size="26" fill="${gold}">?</text>
  `),

  /* 50% off — a big, unmissable numeral that reads from across the hall */
  half: frame(`
    <text x="0" y="0" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="56" fill="${cream}">50<tspan font-size="30" dy="-16">%</tspan></text>
    <rect x="-26" y="22" width="52" height="7" rx="3" fill="${gold}"/>
  `),

  /* Free combo jackpot */
  crown: frame(`
    <path d="M-30 22 L-24 -20 L-9 4 L0 -24 L9 4 L24 -20 L30 22 Z" fill="${gold}"/>
    <rect x="-30" y="20" width="60" height="9" rx="3" fill="${gold}"/>
    <circle cx="0" cy="-24" r="4.6" fill="${red}"/>
    <circle cx="-24" cy="-21" r="4" fill="${red}"/>
    <circle cx="24" cy="-21" r="4" fill="${red}"/>
    <circle cx="0" cy="8" r="4.2" fill="${red}"/>
  `),
}

export function icon(name: IconName, className = ''): string {
  const { viewBox, body } = ICONS[name]
  return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg"${className ? ` class="${className}"` : ''}>${body}</svg>`
}

/**
 * Build an icon as a real nested `<svg>` SVG element, ready to append.
 * Prefer this over `icon()` when the icon lives inside an animated SVG tree.
 */
export function iconSvgEl(name: IconName, doc: Document = document): SVGSVGElement {
  const { viewBox, body } = ICONS[name]
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', viewBox)
  svg.setAttribute('x', '-50')
  svg.setAttribute('y', '-50')
  svg.setAttribute('width', '100')
  svg.setAttribute('height', '100')
  svg.setAttribute('class', 'icon-svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = body
  return svg
}

/* ---------------------------------------------------------------- mascot --- */

export type MascotPose = 'idle' | 'point' | 'thumbs' | 'surprise' | 'cheer'

/**
 * The original Miguel's chicken: black body, red comb, amber beak, cool shades.
 * Deliberately simple silhouette so it reads at a glance and never competes
 * with the wheel.
 */
export function mascotSvg(pose: MascotPose = 'idle'): string {
  const surprise = pose === 'surprise'
  const cheer = pose === 'cheer'
  const point = pose === 'point'
  const thumbs = pose === 'thumbs'

  return `
<svg viewBox="-60 -60 120 120" xmlns="http://www.w3.org/2000/svg" class="mascot-svg">
  <defs>
    <radialGradient id="mBody" cx="38%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#3a3330"/>
      <stop offset="55%" stop-color="#191514"/>
      <stop offset="100%" stop-color="#070606"/>
    </radialGradient>
    <linearGradient id="mBeak" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFC24A"/>
      <stop offset="100%" stop-color="#E07A12"/>
    </linearGradient>
  </defs>

  <g class="mascot__body">
    <!-- comb -->
    <path d="M-4 -34 q-4 -14 6 -16 q-2 -12 10 -10 q4 -12 12 -4 q10 -2 8 10 q-2 8 -8 10 Z"
          fill="${red}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>

    <!-- tail feathers -->
    <g stroke="${ink}" stroke-width="2" stroke-linejoin="round">
      <path d="M-30 6 q-22 -6 -26 -24 q16 2 26 14 Z" fill="#151211"/>
      <path d="M-30 16 q-24 2 -30 -14 q17 -1 29 6 Z" fill="#221d1b"/>
    </g>

    <!-- body -->
    <ellipse cx="0" cy="14" rx="34" ry="33" fill="url(#mBody)" stroke="${ink}" stroke-width="3"/>
    <!-- belly highlight -->
    <ellipse cx="4" cy="24" rx="19" ry="17" fill="#2a2422" opacity=".5"/>

    <!-- legs -->
    <g stroke="#E07A12" stroke-width="5" stroke-linecap="round">
      <path d="M-11 44 v9 M-16 53 h11"/>
      <path d="M13 44 v9 M8 53 h11"/>
    </g>

    <!-- head -->
    <circle cx="0" cy="-8" r="30" fill="url(#mBody)" stroke="${ink}" stroke-width="3"/>

    <!-- beak -->
    <path d="M24 -6 L47 ${surprise ? 2 : -2} L24 6 Z" fill="url(#mBeak)" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    ${surprise ? `<path d="M24 6 L47 2 L24 14 Z" fill="#C96A0C" stroke="${ink}" stroke-width="2"/>` : ''}

    <!-- shades -->
    <g class="mascot__shades">
      <path d="M-27 -12 h54 v6 a13 13 0 0 1 -13 13 h-9 a13 13 0 0 1 -13 -11 v-2 a13 13 0 0 1 -13 11 h-9 a13 13 0 0 1 -13 -13 Z"
            fill="#0d0c0c" stroke="${gold}" stroke-width="2.2"/>
      <path d="M-2 -12 h4" stroke="${gold}" stroke-width="2.2"/>
      <g class="mascot__eye" style="transform-origin: -13px -4px">
        <ellipse cx="-13" cy="-4" rx="8" ry="6" fill="${cream}" opacity=".92"/>
        <circle cx="-11" cy="-4" r="3" fill="${ink}"/>
      </g>
      <g class="mascot__eye" style="transform-origin: 15px -4px">
        <ellipse cx="15" cy="-4" rx="8" ry="6" fill="${cream}" opacity=".92"/>
        <circle cx="17" cy="-4" r="3" fill="${ink}"/>
      </g>
      <path class="mascot__glint" d="M9 -9 l10 -4 l-2 5 Z" fill="${gold}" opacity="0"/>
    </g>

    <!-- wings -->
    <g class="mascot__wing--l">
      <path d="M-32 6 q-16 10 -10 26 q10 6 16 -8 Z" fill="#151211" stroke="${ink}" stroke-width="2.4"/>
    </g>
    <g class="mascot__wing--r" style="transform-origin: 30px 14px">
      <path d="M32 6 q16 10 10 26 q-10 6 -16 -8 Z" fill="#151211" stroke="${ink}" stroke-width="2.4"/>
      ${
        thumbs
          ? `<path d="M40 30 q10 2 12 -8 q1 -6 -5 -6 q-3 -14 -10 -12 q-4 1 -3 6 l3 8 q-8 -2 -9 4 q0 6 12 8 Z"
                    fill="#151211" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>`
          : ''
      }
    </g>

    ${
      cheer
        ? `<g class="mascot__crown">
             <path d="M-20 -44 L-15 -60 L-5 -50 L0 -64 L5 -50 L15 -60 L20 -44 Z" fill="${gold}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
             <rect x="-21" y="-46" width="42" height="7" rx="3" fill="${gold}" stroke="${ink}" stroke-width="2.2"/>
             <circle cx="0" cy="-62" r="3" fill="${red}"/>
           </g>`
        : ''
    }

    ${
      point
        ? `<g class="mascot__point-arm">
             <path d="M28 14 q22 -6 34 -20" stroke="#151211" stroke-width="11" stroke-linecap="round" fill="none"/>
             <circle cx="64" cy="-8" r="7" fill="#151211" stroke="${ink}" stroke-width="2.4"/>
           </g>`
        : ''
    }
  </g>
</svg>`
}
