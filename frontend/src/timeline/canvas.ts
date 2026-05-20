/**
 * Canvas-rendered timeline scrubber.
 *
 * Two large circular handles (≥44 px hit radius) bracket the active window
 * across the piecewise-linear axis. Pointer events drive drags; rendering
 * is throttled through requestAnimationFrame and re-runs on resize via
 * `ResizeObserver` with device-pixel-ratio awareness.
 */

import type { TimeWindow } from "../filter/predicate";

import { formatYear } from "./format";
import { TIMELINE_BOUNDS, TIMELINE_TICKS, clampWindow, pxToYear, yearToPx } from "./scale";

const HANDLE_RADIUS = 22; // 44px diameter touch target
const TRACK_THICKNESS = 6;

/** Constructor options. */
export interface TimelineCanvasOptions {
  canvas: HTMLCanvasElement;
  /** Initial window. */
  initialWindow: TimeWindow;
  /** Fires whenever the user changes the window via drag. */
  onChange: (w: TimeWindow) => void;
}

type ActiveHandle = "start" | "end" | null;

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
  private dragOffsetPx = 0;
  private rafHandle: number | null = null;
  private readonly resizeObserver: ResizeObserver;

  constructor(opts: TimelineCanvasOptions) {
    this.canvas = opts.canvas;
    const ctx = opts.canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("TimelineCanvas: canvas 2D context unavailable");
    }
    this.ctx = ctx;
    this.window = clampWindow(opts.initialWindow);
    this.onChange = opts.onChange;

    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(this.canvas);
    this.requestRender();
  }

  /** Replace the window programmatically (e.g. from URL hash). */
  setWindow(w: TimeWindow): void {
    this.window = clampWindow(w);
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

    const trackY = h / 2;
    const padX = HANDLE_RADIUS + 4;
    const trackWidth = Math.max(1, w - padX * 2);

    // Inactive track.
    ctx.fillStyle = "#d8d3c8";
    ctx.fillRect(padX, trackY - TRACK_THICKNESS / 2, trackWidth, TRACK_THICKNESS);

    // Tick marks.
    ctx.fillStyle = "#8c8479";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const tickYear of TIMELINE_TICKS) {
      const x = padX + yearToPx(tickYear, trackWidth);
      ctx.fillRect(x - 0.5, trackY + TRACK_THICKNESS / 2 + 2, 1, 4);
      ctx.fillText(formatYear(tickYear), x, trackY + TRACK_THICKNESS / 2 + 8);
    }

    // Active window fill.
    const startX = padX + yearToPx(this.window.start, trackWidth);
    const endX = padX + yearToPx(this.window.end, trackWidth);
    ctx.fillStyle = "#e07a3c";
    ctx.fillRect(startX, trackY - TRACK_THICKNESS / 2, endX - startX, TRACK_THICKNESS);

    // Handles.
    drawHandle(ctx, startX, trackY);
    drawHandle(ctx, endX, trackY);

    // Year labels above the handles.
    ctx.fillStyle = "#3a3530";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatYear(this.window.start), startX, trackY - HANDLE_RADIUS - 2);
    ctx.fillText(formatYear(this.window.end), endX, trackY - HANDLE_RADIUS - 2);

    ctx.restore();
  }

  private hitTest(clientX: number, clientY: number): ActiveHandle {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const padX = HANDLE_RADIUS + 4;
    const trackWidth = Math.max(1, rect.width - padX * 2);
    const startX = padX + yearToPx(this.window.start, trackWidth);
    const endX = padX + yearToPx(this.window.end, trackWidth);
    const trackY = rect.height / 2;
    const dStart = Math.hypot(localX - startX, localY - trackY);
    const dEnd = Math.hypot(localX - endX, localY - trackY);
    if (dStart <= HANDLE_RADIUS && dStart <= dEnd) return "start";
    if (dEnd <= HANDLE_RADIUS) return "end";
    return null;
  }

  private localXToYear(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const padX = HANDLE_RADIUS + 4;
    const trackWidth = Math.max(1, rect.width - padX * 2);
    const localX = clientX - rect.left;
    return pxToYear(localX - padX, trackWidth);
  }

  private readonly handlePointerDown = (e: PointerEvent): void => {
    const which = this.hitTest(e.clientX, e.clientY);
    if (which === null) return;
    this.dragging = which;
    this.dragOffsetPx = 0;
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (this.dragging === null) return;
    const year = Math.round(this.localXToYear(e.clientX));
    if (this.dragging === "start") {
      const next = clampWindow({ start: year, end: this.window.end });
      if (next.start !== this.window.start) {
        this.window = next;
        this.requestRender();
        this.onChange(this.window);
      }
    } else {
      const next = clampWindow({ start: this.window.start, end: year });
      if (next.end !== this.window.end) {
        this.window = next;
        this.requestRender();
        this.onChange(this.window);
      }
    }
    void this.dragOffsetPx;
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (this.dragging === null) return;
    this.dragging = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore; capture may not have been claimed on some browsers
    }
  };
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, HANDLE_RADIUS - 4, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3a3530";
  ctx.stroke();
}

/** Re-export for callers that want the bounds without importing scale.ts. */
export { TIMELINE_BOUNDS };
