/**
 * Tiny synchronous reactive store.
 *
 * Replaces a UI framework's state primitive for this app. The full new state
 * is delivered to every subscriber on every `set`; consumers compare the
 * fields they care about themselves. No async, no batching, no derived
 * selectors — keep it small.
 */

import type { FilterFlags, TimeWindow } from "../filter/predicate";

/** A subscriber callback receives the new full state. */
export type StoreSubscriber<T> = (state: T) => void;

/** Public store interface returned by {@link createStore}. */
export interface Store<T> {
  /** Current state snapshot. */
  get: () => T;
  /** Merge a partial update and notify every subscriber. */
  set: (patch: Partial<T>) => void;
  /** Register a subscriber; returns a cleanup function. */
  subscribe: (fn: StoreSubscriber<T>) => () => void;
}

/**
 * Construct a store from an initial state.
 *
 * `set` does shallow merge; if every patched key is reference-equal to its
 * previous value (cheap object-identity check), notification is skipped.
 */
export function createStore<T extends object>(initial: T): Store<T> {
  let state: T = initial;
  const subs = new Set<StoreSubscriber<T>>();
  return {
    get: () => state,
    set: (patch) => {
      let changed = false;
      for (const key of Object.keys(patch) as (keyof T)[]) {
        if (patch[key] !== state[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const fn of subs) fn(state);
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Top-level reactive state for the app. */
export interface AppState {
  window: TimeWindow;
  visibleCountries: ReadonlySet<string>;
  selectedCountry: string | null;
  mapCenter: readonly [number, number];
  mapZoom: number;
  filters: FilterFlags;
}
