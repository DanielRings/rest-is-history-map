/**
 * Ruler-style timeline scrubber for touch devices.
 *
 * Inverts the classic slider: the scale scrolls and the markers stay put,
 * like a mobile ruler/number picker. Two chevrons sit at fixed fractions of
 * the width and read off whatever year the ruler has brought under them.
 *
 * Why this shape, on a phone specifically:
 *   - Precision stops depending on screen width. The old rail squeezed 5025
 *     years into ~323px, so a thumb-width covered 2838 years in antiquity;
 *     here the tick spacing is a property of the zoom, not of the range.
 *   - The two markers can never collide. They live at fixed screen positions
 *     ~76% of the width apart, so "grab the handle you meant" is not a
 *     problem that can occur, whether the window spans one year or three
 *     thousand.
 *   - Nothing sits under your thumb. The readouts are above the chevrons,
 *     and the gesture surface is the whole rail.
 *
 * The scale here is LINEAR, unlike `TimelineCanvas`'s density-weighted
 * piecewise axis: a ruler that stretched unevenly under a moving finger
 * would feel broken.
 *
 * Integration note: this never drives playback. It renders whatever window
 * the store holds and emits user gestures back, so `setWindow` from playback
 * simply scrolls the ruler — which is exactly the animation we want anyway.
 */

import type { TimeWindow } from "../filter/predicate";

import { formatYearTick } from "./format";
import { TIMELINE_BOUNDS, clampWindow } from "./scale";

/** Horizontal position of the start/end chevrons, as a fraction of width. */
const CHEVRON_LEFT_FRAC = 0.12;
const CHEVRON_RIGHT_FRAC = 0.88;
/** Chevrons may be dragged within these bounds, never closer than the gap. */
const CHEVRON_MIN_FRAC = 0.06;
const CHEVRON_MAX_FRAC = 0.94;
const CHEVRON_MIN_GAP_FRAC = 0.18;
/** Pointer distance (px) within which a press grabs a chevron rather than pans. */
const CHEVRON_GRAB_PX = 26;

/** Vertical layout, in CSS px from the top of the canvas. */
const READOUT_TOP = 1;
const CHEVRON_TOP = 29;
const CHEVRON_H = 9;
const RULER_BASELINE = 42;
const MINOR_TICK_H = 6;
const MAJOR_TICK_H = 11;
const TICK_LABEL_TOP = 56;

/** Candidate tick intervals, in years. */
const NICE_STEPS: readonly number[] = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
/** Minimum on-screen spacing for minor ticks and for labelled ticks. */
const MIN_MINOR_PX = 7;
const MIN_LABEL_PX = 64;

/** Flick handling. */
const MOMENTUM_FRICTION = 0.94;
const MOMENTUM_MIN_PX_PER_MS = 0.02;

/** Constructor options — mirrors {@link TimelineCanvas} so they interchange. */
export interface RulerTimelineOptions {
  canvas: HTMLCanvasElement;
  /** Initial window. */
  initialWindow: TimeWindow;
  /** Fires whenever the user changes the window via a gesture. */
  onChange: (w: TimeWindow) => void;
}

/** Pick the smallest "nice" interval that renders at least `minPx` apart. */
function chooseStep(yearsPerPx: number, minPx: number): number {
  for (const step of NICE_STEPS) {
    if (step / yearsPerPx >= minPx) return step;
  }
  const last = NICE_STEPS[NICE_STEPS.length - 1];
  return last === undefined ? 1000 : last;
}

/**
 * Ruler scrubber. Same surface as {@link TimelineCanvas}: construct, feed it
 * `setWindow`, listen via `onChange`, `dispose` when done.
 */
export class RulerTimeline {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly onChange: (w: TimeWindow) => void;
  private readonly resizeObserver: ResizeObserver;

  /** Year at the horizontal centre of the canvas. */
  private centerYear = 0;
  /** Zoom, as years per CSS pixel. */
  private yearsPerPx = 1;
  private leftFrac = CHEVRON_LEFT_FRAC;
  private rightFrac = CHEVRON_RIGHT_FRAC;

  private rafId: number | null = null;
  /** Window most recently emitted, so external echoes don't re-anchor us. */
  private lastEmitted: TimeWindow | null = null;

  /** Active pointers, for pan vs. pinch. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragging: "pan" | "left" | "right" | null = null;
  private panLastX = 0;
  private pinchLastDist = 0;
  /** Velocity tracking for flick momentum. */
  private velocityPxPerMs = 0;
  private lastMoveAt = 0;
  private momentumId: number | null = null;

  constructor(opts: RulerTimelineOptions) {
    this.canvas = opts.canvas;
    this.onChange = opts.onChange;
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) throw new Error("RulerTimeline: 2D context unavailable");
    this.ctx = ctx;

    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(this.canvas);

    this.adoptWindow(opts.initialWindow);
    this.requestRender();
  }

  /** External write path: re-anchor the ruler onto `w`. */
  setWindow(w: TimeWindow): void {
    const last = this.lastEmitted;
    if (last !== null && last.start === w.start && last.end === w.end) return;
    // A gesture in flight owns the view; adopting here would fight the finger.
    if (this.dragging !== null) return;
    this.adoptWindow(w);
    this.requestRender();
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.resizeObserver.disconnect();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.momentumId !== null) cancelAnimationFrame(this.momentumId);
  }

  // ---------------------------------------------------------------- geometry

  private widthPx(): number {
    return Math.max(1, this.canvas.getBoundingClientRect().width);
  }

  private leftX(): number {
    return this.leftFrac * this.widthPx();
  }

  private rightX(): number {
    return this.rightFrac * this.widthPx();
  }

  private yearAtX(x: number): number {
    return this.centerYear + (x - this.widthPx() / 2) * this.yearsPerPx;
  }

  private xForYear(year: number): number {
    return this.widthPx() / 2 + (year - this.centerYear) / this.yearsPerPx;
  }

  /**
   * Set zoom and pan so the chevrons land on `w`'s edges.
   *
   * A single-year window has start === end, which would imply zero years per
   * pixel; it is treated as one year across the chevron gap instead, i.e. the
   * most zoomed-in state the ruler can express.
   */
  private adoptWindow(w: TimeWindow): void {
    const gapPx = Math.max(1, this.rightX() - this.leftX());
    const spanYears = Math.max(1, w.end - w.start);
    this.yearsPerPx = spanYears / gapPx;
    this.centerYear = w.start + (this.widthPx() / 2 - this.leftX()) * this.yearsPerPx;
  }

  /** Read the current window off the chevrons and publish it. */
  private emit(): void {
    const spanYears = (this.rightX() - this.leftX()) * this.yearsPerPx;
    const start = Math.round(this.yearAtX(this.leftX()));
    // Below ~1.5 years the two chevrons are pointing at the same year; report
    // that as the app's single-year window (start === end) rather than an
    // arbitrary one-year range.
    const end = spanYears < 1.5 ? start : Math.round(this.yearAtX(this.rightX()));
    const next = clampWindow({ start, end });
    this.lastEmitted = next;
    this.onChange(next);
  }

  /** Keep the visible window inside the axis bounds. */
  private clampPan(): void {
    const startYear = this.yearAtX(this.leftX());
    const endYear = this.yearAtX(this.rightX());
    if (startYear < TIMELINE_BOUNDS.min) {
      this.centerYear += TIMELINE_BOUNDS.min - startYear;
    } else if (endYear > TIMELINE_BOUNDS.max) {
      this.centerYear -= endYear - TIMELINE_BOUNDS.max;
    }
  }

  // ---------------------------------------------------------------- gestures

  private readonly handlePointerDown = (e: PointerEvent): void => {
    this.stopMomentum();
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    this.canvas.setPointerCapture(e.pointerId);

    if (this.pointers.size === 2) {
      this.dragging = "pan";
      this.pinchLastDist = this.pointerDistance();
      return;
    }
    if (Math.abs(e.offsetX - this.leftX()) <= CHEVRON_GRAB_PX) {
      this.dragging = "left";
    } else if (Math.abs(e.offsetX - this.rightX()) <= CHEVRON_GRAB_PX) {
      this.dragging = "right";
    } else {
      this.dragging = "pan";
      this.panLastX = e.offsetX;
      this.velocityPxPerMs = 0;
      this.lastMoveAt = performance.now();
    }
    e.preventDefault();
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (this.dragging === null) return;
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });

    if (this.pointers.size >= 2) {
      this.applyPinch();
      this.requestRender();
      this.emit();
      return;
    }

    if (this.dragging === "pan") {
      const dx = e.offsetX - this.panLastX;
      this.panLastX = e.offsetX;
      // Drag the ruler, not the cursor: moving the finger right reveals
      // earlier years, exactly like sliding a physical rule under a mark.
      this.centerYear -= dx * this.yearsPerPx;
      this.clampPan();
      const now = performance.now();
      const dt = Math.max(1, now - this.lastMoveAt);
      this.velocityPxPerMs = dx / dt;
      this.lastMoveAt = now;
    } else {
      const w = this.widthPx();
      const frac = Math.min(CHEVRON_MAX_FRAC, Math.max(CHEVRON_MIN_FRAC, e.offsetX / w));
      if (this.dragging === "left") {
        this.leftFrac = Math.min(frac, this.rightFrac - CHEVRON_MIN_GAP_FRAC);
      } else {
        this.rightFrac = Math.max(frac, this.leftFrac + CHEVRON_MIN_GAP_FRAC);
      }
    }
    this.requestRender();
    this.emit();
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Capture may never have been claimed; nothing to release.
    }
    if (this.pointers.size > 0) {
      // Pinch dropped to a single finger. Re-seat the pan origin on whichever
      // pointer is left, or the next move would jump by the gap between them.
      const remaining = [...this.pointers.values()][0];
      if (remaining !== undefined) {
        this.dragging = "pan";
        this.panLastX = remaining.x;
        this.pinchLastDist = 0;
        this.velocityPxPerMs = 0;
        this.lastMoveAt = performance.now();
      }
      return;
    }
    const wasPanning = this.dragging === "pan";
    this.dragging = null;
    if (wasPanning && Math.abs(this.velocityPxPerMs) > MOMENTUM_MIN_PX_PER_MS) {
      this.startMomentum();
    }
  };

  private pointerDistance(): number {
    const pts = [...this.pointers.values()];
    const a = pts[0];
    const b = pts[1];
    if (a === undefined || b === undefined) return 0;
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  /** Zoom about the midpoint between the two fingers. */
  private applyPinch(): void {
    const dist = this.pointerDistance();
    if (this.pinchLastDist === 0) {
      this.pinchLastDist = dist;
      return;
    }
    const pts = [...this.pointers.values()];
    const a = pts[0];
    const b = pts[1];
    if (a === undefined || b === undefined) return;
    const midX = (a.x + b.x) / 2;
    const anchorYear = this.yearAtX(midX);
    const scale = dist / this.pinchLastDist;
    this.pinchLastDist = dist;

    const gapPx = Math.max(1, this.rightX() - this.leftX());
    // Zoom limits expressed as the span between the chevrons: no tighter than
    // a single year, no wider than the whole axis.
    const minYearsPerPx = 1 / gapPx;
    const maxYearsPerPx = (TIMELINE_BOUNDS.max - TIMELINE_BOUNDS.min) / gapPx;
    this.yearsPerPx = Math.min(maxYearsPerPx, Math.max(minYearsPerPx, this.yearsPerPx / scale));
    // Hold the pinch midpoint steady under the fingers.
    this.centerYear = anchorYear - (midX - this.widthPx() / 2) * this.yearsPerPx;
    this.clampPan();
  }

  private startMomentum(): void {
    let velocity = this.velocityPxPerMs;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = Math.max(1, now - last);
      last = now;
      velocity *= Math.pow(MOMENTUM_FRICTION, dt / 16);
      if (Math.abs(velocity) < MOMENTUM_MIN_PX_PER_MS) {
        this.momentumId = null;
        return;
      }
      this.centerYear -= velocity * dt * this.yearsPerPx;
      this.clampPan();
      this.requestRender();
      this.emit();
      this.momentumId = requestAnimationFrame(step);
    };
    this.momentumId = requestAnimationFrame(step);
  }

  private stopMomentum(): void {
    if (this.momentumId !== null) {
      cancelAnimationFrame(this.momentumId);
      this.momentumId = null;
    }
  }

  // ----------------------------------------------------------------- render

  private requestRender(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v.length > 0 ? v : fallback;
  }

  private render(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const trackColor = this.cssVar("--timeline-track", "#d3c19a");
    const activeColor = this.cssVar("--timeline-track-active", "#9c3b2a");
    const labelColor = this.cssVar("--timeline-label", "#2e2418");
    const mutedColor = this.cssVar("--fg-muted", "#6f5d44");
    const readoutFont = this.cssVar("--timeline-readout-font", "600 21px system-ui, sans-serif");
    const tickFont = this.cssVar("--timeline-ruler-tick-font", "11px system-ui, sans-serif");

    const lx = this.leftX();
    const rx = this.rightX();

    // Band between the chevrons — the selected window.
    ctx.fillStyle = activeColor;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(lx, CHEVRON_TOP, rx - lx, RULER_BASELINE - CHEVRON_TOP);
    ctx.globalAlpha = 1;

    // Ruler ticks. Only within the axis bounds — beyond them there is no
    // timeline, and drawing ticks there would imply otherwise.
    const minorStep = chooseStep(this.yearsPerPx, MIN_MINOR_PX);
    const labelStep = chooseStep(this.yearsPerPx, MIN_LABEL_PX);
    const firstYear = Math.max(TIMELINE_BOUNDS.min, this.yearAtX(0));
    const lastYear = Math.min(TIMELINE_BOUNDS.max, this.yearAtX(w));
    const firstTick = Math.ceil(firstYear / minorStep) * minorStep;

    ctx.strokeStyle = trackColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER_BASELINE);
    ctx.lineTo(w, RULER_BASELINE);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let year = firstTick; year <= lastYear; year += minorStep) {
      const x = this.xForYear(year);
      if (x < -20 || x > w + 20) continue;
      const isLabelled = year % labelStep === 0;
      ctx.strokeStyle = isLabelled ? mutedColor : trackColor;
      ctx.lineWidth = isLabelled ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, RULER_BASELINE);
      ctx.lineTo(x, RULER_BASELINE + (isLabelled ? MAJOR_TICK_H : MINOR_TICK_H));
      ctx.stroke();
      if (isLabelled) {
        ctx.fillStyle = mutedColor;
        ctx.font = tickFont;
        ctx.fillText(formatYearTick(year), x, TICK_LABEL_TOP);
      }
    }

    // Chevrons, then the readouts above them.
    this.drawChevron(ctx, lx, activeColor);
    this.drawChevron(ctx, rx, activeColor);

    const spanYears = (rx - lx) * this.yearsPerPx;
    const startYear = Math.round(this.yearAtX(lx));
    ctx.fillStyle = labelColor;
    ctx.font = readoutFont;
    ctx.textBaseline = "top";
    if (spanYears < 1.5) {
      ctx.textAlign = "center";
      ctx.fillText(formatYearTick(startYear), (lx + rx) / 2, READOUT_TOP);
    } else {
      ctx.textAlign = "left";
      ctx.fillText(formatYearTick(startYear), Math.max(2, lx - 4), READOUT_TOP);
      ctx.textAlign = "right";
      ctx.fillText(
        formatYearTick(Math.round(this.yearAtX(rx))),
        Math.min(w - 2, rx + 4),
        READOUT_TOP,
      );
    }

    ctx.restore();
  }

  private drawChevron(ctx: CanvasRenderingContext2D, x: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 6, CHEVRON_TOP);
    ctx.lineTo(x + 6, CHEVRON_TOP);
    ctx.lineTo(x, CHEVRON_TOP + CHEVRON_H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, CHEVRON_TOP + CHEVRON_H);
    ctx.lineTo(x, RULER_BASELINE);
    ctx.stroke();
  }
}
