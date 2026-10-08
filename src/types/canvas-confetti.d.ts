/**
 * Local typings for canvas-confetti.
 *
 * Shapes must be structured-cloneable: when `OffscreenCanvas` is available the
 * library renders particles inside a Worker and postMessages the options, so a
 * function-based custom shape throws. These declarations describe the cloneable
 * contract the library actually implements.
 */
declare module 'canvas-confetti' {
  export interface Origin {
    x?: number
    y?: number
  }

  export interface PathShape {
    type: 'path'
    /** SVG path data, drawn on the main thread only. */
    path: string
    /** A 6-element DOMMatrix array. */
    matrix: number[]
  }

  export type BuiltInShape = 'square' | 'circle' | 'star' | 'diamond' | 'triangle'

  export type Shape = BuiltInShape | PathShape

  export interface Options {
    particleCount?: number
    angle?: number
    spread?: number
    startVelocity?: number
    decay?: number
    gravity?: number
    drift?: number
    ticks?: number
    flat?: boolean
    origin?: Origin
    colors?: readonly string[]
    shapes?: readonly Shape[]
    scalar?: number
    zIndex?: number
    disableForReducedMotion?: boolean
  }

  const confetti: (options?: Options) => Promise<undefined> | null
  export default confetti
}
