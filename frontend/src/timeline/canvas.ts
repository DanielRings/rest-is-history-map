/**
 * Canvas-rendered timeline scrubber.
 *
 * Two large circular handles (≥44 px hit radius) bracket the active window
 * across the piecewise-linear axis. Pointer events drive drags; rendering
 * is throttled through requestAnimationFrame and re-runs on resize via
 * `ResizeObserver` with device-pixel-ratio awareness.
 */

import type { TimeWindow } from "../filter/predicate";

import { formatYearTick } from "./format";
import { TIMELINE_BOUNDS, clampWindow, pxToYear, yearToPx } from "./scale";

const HANDLE_RADIUS = 22; // 44px diameter touch target
const HANDLE_DRAW_RADIUS = HANDLE_RADIUS - 8; // visible disc; smaller than touch target
const TRACK_THICKNESS = 9; // 1.5× thicker than the original 6px rail
/** Pixels of pointer movement above which a release is a drag (not a click). */
const CLICK_SLOP_PX = 4;
/** Ms within which a second tap counts as a double-tap. */
const DOUBLE_TAP_MS = 350;
/** When toggling year→range, expand to ±this many years (clamped to bounds). */
const RANGE_EXPAND_HALFSPAN = 100;
/**
 * Rail centre, measured up from the bottom of the canvas.
 *
 * The rail is deliberately not vertically centred: the year readout occupies
 * a band across the top, so the rail sits low enough to clear it while still
 * leaving the handle's full 44px touch circle inside the canvas.
 */
const TRACK_BOTTOM_OFFSET = 26;
/** Inset of the pinned year readouts from the canvas edges. */
const READOUT_INSET_PX = 8;
/** Baseline offset of the readout band from the top of the canvas. */
const READOUT_TOP_PX = 2;

/**
 * Vertical centre of the rail for a given canvas height.
 *
 * Shared by rendering and hit-testing — if these two ever disagree, handles
 * draw in one place and respond in another.
 *
 * @param h - Canvas height in CSS pixels.
 * @returns The rail's centre y, in CSS pixels.
 */
function trackYFor(h: number): number {
  return h - TRACK_BOTTOM_OFFSET;
}

/** Constructor options. */
export interface TimelineCanvasOptions {
  canvas: HTMLCanvasElement;
  /** Initial window. */
  initialWindow: TimeWindow;
  /** Fires whenever the user changes the window via drag. */
  onChange: (w: TimeWindow) => void;
}

type ActiveHandle = "start" | "end" | "year" | null;

/**
 * Canvas-backed two-thumb range slider over the piecewise-linear year axis.
 *
 * Construction wires pointer + resize listeners and paints once. The
 * `setWindow` method is the external write path; the `onChange` callback
 * is the external read path. `dispose` releases everything.
 */
export class TimelineCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly onChange: (w: TimeWindow) => void;
  private window: TimeWindow;
  private dragging: ActiveHandle = null;
  private rafHandle: number | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly supportsHover: boolean;
  /** Last range window observed (start !== end). Saved automatically when
   *  the window collapses to year mode, restored when the user double-clicks
   *  out of year mode. Null if no range has been seen yet. */
  private savedRange: TimeWindow | null = null;
  // Click vs. drag bookkeeping. Set on pointerdown; consulted on pointerup
  // to decide whether the gesture was a click (mode switch candidate) or a
  // drag (no mode switch).
  private downX = 0;
  private downHandle: ActiveHandle = null;
  private moveDistMax = 0;
  // Double-tap detection.
  private lastTapAt = 0;
  private lastTapX = 0;
  private lastTapHandle: ActiveHandle = null;

  constructor(opts: TimelineCanvasOptions) {
    this.canvas = opts.canvas;
    const ctx = opts.canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("TimelineCanvas: canvas 2D context unavailable");
    }
    this.ctx = ctx;
    this.window = clampWindow(opts.initialWindow);
    this.onChange = opts.onChange;
    this.supportsHover =
      typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;
    if (this.window.start !== this.window.end) {
      this.savedRange = { ...this.window };
    }

    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(this.canvas);
    this.requestRender();
  }

  /** Replace the window programmatically (e.g. from URL hash). Auto-saves
   *  the previous range when a range collapses to year mode, so a later
   *  toggle back to range mode can restore the same span. */
  setWindow(w: TimeWindow): void {
    const next = clampWindow(w);
    if (this.window.start !== this.window.end && next.start === next.end) {
      this.savedRange = { ...this.window };
    } else if (next.start !== next.end) {
      this.savedRange = { ...next };
    }
    this.window = next;
    this.requestRender();
  }

  /** Current window snapshot. */
  getWindow(): TimeWindow {
    return this.window;
  }

  /** Detach all listeners. */
  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.resizeObserver.disconnect();
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
  }

  private requestRender(): void {
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.render();
    });
  }

  private isYearMode(): boolean {
    return this.window.start === this.window.end;
  }

  /** Read a CSS custom property (with fallback) from :root. Cached per
   *  render so we read each token at most once per frame. */
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

    // Read theme tokens once per frame.
    const trackColor = this.cssVar("--timeline-track", "#d8d3c8");
    const trackActiveColor = this.cssVar("--timeline-track-active", "#e07a3c");
    const labelColor = this.cssVar("--timeline-label", "#3a3530");
    const handleFill = this.cssVar("--timeline-handle-fill", "#ffffff");
    const handleBorder = this.cssVar("--timeline-handle-border", "#3a3530");
    const readoutFont = this.cssVar("--timeline-readout-font", "600 20px system-ui, sans-serif");

    const trackY = trackYFor(h);
    const padX = HANDLE_RADIUS + 4;
    const trackWidth = Math.max(1, w - padX * 2);

    ctx.fillStyle = trackColor;
    ctx.fillRect(padX, trackY - TRACK_THICKNESS / 2, trackWidth, TRACK_THICKNESS);

    const startX = padX + yearToPx(this.window.start, trackWidth);
    const endX = padX + yearToPx(this.window.end, trackWidth);

    if (this.isYearMode()) {
      const playheadX = startX;
      ctx.fillStyle = trackActiveColor;
      ctx.fillRect(playheadX - 1.5, trackY - HANDLE_RADIUS + 2, 3, HANDLE_RADIUS * 2 - 4);
      ctx.beginPath();
      ctx.arc(playheadX, trackY + HANDLE_RADIUS - 4, 6, 0, Math.PI * 2);
      ctx.fillStyle = handleFill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = trackActiveColor;
      ctx.stroke();
    } else {
      ctx.fillStyle = trackActiveColor;
      ctx.fillRect(startX, trackY - TRACK_THICKNESS / 2, endX - startX, TRACK_THICKNESS);
      drawHandle(ctx, startX, trackY, handleFill, handleBorder);
      drawHandle(ctx, endX, trackY, handleFill, handleBorder);
    }

    // Year readout. Pinned to the canvas edges rather than tracking the
    // handles: at this width the two labels collided constantly, and anchoring
    // them means the numbers change in place instead of sliding around. A
    // single-year window collapses to one centred figure, since a "start" and
    // "end" either side of the screen would be the same number twice.
    ctx.fillStyle = labelColor;
    ctx.font = readoutFont;
    ctx.textBaseline = "top";
    if (this.isYearMode()) {
      ctx.textAlign = "center";
      ctx.fillText(formatYearTick(this.window.start), w / 2, READOUT_TOP_PX);
    } else {
      ctx.textAlign = "left";
      ctx.fillText(formatYearTick(this.window.start), READOUT_INSET_PX, READOUT_TOP_PX);
      ctx.textAlign = "right";
      ctx.fillText(formatYearTick(this.window.end), w - READOUT_INSET_PX, READOUT_TOP_PX);
    }

    ctx.restore();
  }

  /**
   * Hit-test in canvas-local coordinates.
   *
   * Local (not client) coordinates on purpose: the canvas is inside a
   * `position: fixed` panel, and on iOS a fixed element's
   * `getBoundingClientRect()` is measured against the *layout* viewport
   * while pointer `clientX/clientY` are measured against the *visual*
   * viewport. Those diverge exactly when the page is scrolled and Safari's
   * bars minimize, which silently moved every hit target. `offsetX/offsetY`
   * are resolved by the browser against this element, so they can't drift.
   */
  private hitTest(localX: number, localY: number): ActiveHandle {
    const rect = this.canvas.getBoundingClientRect();
    const padX = HANDLE_RADIUS + 4;
    const trackWidth = Math.max(1, rect.width - padX * 2);
    const trackY = trackYFor(rect.height);

    if (this.isYearMode()) {
      // In year mode any pointerdown that's vertically near the rail
      // jumps the playhead. Hit-test is a generous horizontal band.
      if (Math.abs(localY - trackY) <= HANDLE_RADIUS) return "year";
      return null;
    }

    const startX = padX + yearToPx(this.window.start, trackWidth);
    const endX = padX + yearToPx(this.window.end, trackWidth);
    const dStart = Math.hypot(localX - startX, localY - trackY);
    const dEnd = Math.hypot(localX - endX, localY - trackY);
    if (dStart <= HANDLE_RADIUS && dStart <= dEnd) return "start";
    if (dEnd <= HANDLE_RADIUS) return "end";
    return null;
  }

  /** Convert a canvas-local x to a year. See {@link hitTest} on why local. */
  private localXToYear(localX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const padX = HANDLE_RADIUS + 4;
    const trackWidth = Math.max(1, rect.width - padX * 2);
    return pxToYear(localX - padX, trackWidth);
  }

  private readonly handlePointerDown = (e: PointerEvent): void => {
    const which = this.hitTest(e.offsetX, e.offsetY);
    this.downX = e.offsetX;
    this.downHandle = which;
    this.moveDistMax = 0;
    if (which === null) {
      // Empty rail (range mode + click off the handles). Don't start a
      // drag; the gesture may turn out to be a click/dblclick that
      // switches mode. We still need pointerup, which the browser delivers
      // without explicit capture.
      return;
    }
    this.dragging = which;
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (which === "year") {
      // Year mode: snap the playhead immediately so a tap-then-release
      // works as "select this year" without requiring a drag.
      this.applyYearAt(e.offsetX);
    }
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    this.moveDistMax = Math.max(this.moveDistMax, Math.abs(e.offsetX - this.downX));
    if (this.dragging === null) return;
    const year = Math.round(this.localXToYear(e.offsetX));
    if (this.dragging === "year") {
      this.applyYearAt(e.offsetX);
    } else if (this.dragging === "start") {
      const next = clampWindow({ start: year, end: this.window.end });
      if (next.start !== this.window.start) {
        this.window = next;
        if (next.start !== next.end) this.savedRange = { ...next };
        this.requestRender();
        this.onChange(this.window);
      }
    } else {
      const next = clampWindow({ start: this.window.start, end: year });
      if (next.end !== this.window.end) {
        this.window = next;
        if (next.start !== next.end) this.savedRange = { ...next };
        this.requestRender();
        this.onChange(this.window);
      }
    }
  };

  private applyYearAt(localX: number): void {
    const year = Math.round(this.localXToYear(localX));
    const next = clampWindow({ start: year, end: year });
    if (next.start !== this.window.start || next.end !== this.window.end) {
      this.window = next;
      this.requestRender();
      this.onChange(this.window);
    }
  }

  private readonly handlePointerUp = (e: PointerEvent): void => {
    const wasDragging = this.dragging !== null;
    if (wasDragging) {
      this.dragging = null;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore; capture may not have been claimed on some browsers
      }
    }
    // Only count gestures with negligible movement as clicks. This keeps a
    // small drag of a handle from triggering an unintended mode switch.
    if (this.moveDistMax > CLICK_SLOP_PX) return;
    this.handleClickRelease(this.downHandle, e.offsetX);
  };

  /**
   * Decide whether the just-released click should switch timeline mode.
   *
   * Rules (per W3.5 design):
   * - Range mode + click on empty rail: desktop single-click OR mobile
   *   double-tap → switch to year mode at that x.
   * - Year mode + click on the playhead/rail: double-tap/click (any
   *   platform) → switch to range mode, expanded ±RANGE_EXPAND_HALFSPAN
   *   around the current year.
   * - Click on a range-mode handle: never switches mode.
   */
  private handleClickRelease(handle: ActiveHandle, localX: number): void {
    const now = performance.now();
    const isDoubleTap =
      now - this.lastTapAt < DOUBLE_TAP_MS &&
      Math.abs(localX - this.lastTapX) < 16 &&
      this.lastTapHandle === handle;
    this.lastTapAt = now;
    this.lastTapX = localX;
    this.lastTapHandle = handle;

    const inYearMode = this.isYearMode();

    if (inYearMode && handle === "year" && isDoubleTap) {
      // Year → Range. Prefer the most recently observed range so the user
      // gets back exactly where they were; fall back to ±RANGE_EXPAND
      // around the current year if no range has been recorded.
      const restored =
        this.savedRange ??
        clampWindow({
          start: Math.max(TIMELINE_BOUNDS.min, this.window.start - RANGE_EXPAND_HALFSPAN),
          end: Math.min(TIMELINE_BOUNDS.max, this.window.start + RANGE_EXPAND_HALFSPAN),
        });
      this.window = clampWindow(restored);
      this.requestRender();
      this.onChange(this.window);
      return;
    }

    if (!inYearMode && handle === null) {
      // Range → Year (empty-rail click). Desktop = single click switches;
      // mobile = wait for double-tap. Save the current range first so we
      // can restore it on the way back.
      if (this.supportsHover || isDoubleTap) {
        this.savedRange = { ...this.window };
        const year = Math.round(this.localXToYear(localX));
        this.window = clampWindow({ start: year, end: year });
        this.requestRender();
        this.onChange(this.window);
      }
    }
  }
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fill: string,
  stroke: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, HANDLE_DRAW_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/** Re-export for callers that want the bounds without importing scale.ts. */
export { TIMELINE_BOUNDS };
