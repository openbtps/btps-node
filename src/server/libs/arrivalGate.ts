/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/** Since 1.2: how many artifacts may wait for a place, once `maxArtifactsInFlight` is set, unless the server sets `maxArtifactsWaiting`. */
export const DEFAULT_MAX_ARTIFACTS_WAITING = 100;

/** A place taken: `leave()` gives it up, once; calling it again does nothing. */
export type BTPArrivalLeave = () => void;

/** What `enter()` gives: a place now, a wait for one, or none (the queue is full). */
export type BTPArrivalTicket =
  | { readonly state: 'in'; readonly leave: BTPArrivalLeave }
  | {
      readonly state: 'waiting';
      /** A place, when one frees; undefined when `cancel()` was called first. */
      readonly admitted: Promise<BTPArrivalLeave | undefined>;
      /** Stops waiting: the place, should one come, goes to the next. */
      readonly cancel: () => void;
    }
  | { readonly state: 'full' };

/**
 * Since 1.2, internal to the SDK: how many artifacts the whole server reads and handles at once.
 * An artifact takes a place from its first byte until it is answered; one that finds none waits,
 * in order of arrival, while nothing more of it is read, so TCP holds its sender back and it costs
 * no memory. Past `maxWaiting`, the next is refused at once.
 */
export class BtpsArrivalGate {
  readonly #maxInFlight: number;
  readonly #maxWaiting: number;
  #inFlight = 0;
  /** Insertion-ordered, so the first waiting is the first in; a cancelled wait is deleted at once. */
  readonly #waiting = new Set<(leave: BTPArrivalLeave | undefined) => void>();

  constructor(maxInFlight: number, maxWaiting: number) {
    this.#maxInFlight = maxInFlight;
    this.#maxWaiting = maxWaiting;
  }

  /** Artifacts with a place. */
  get inFlight(): number {
    return this.#inFlight;
  }

  /** Artifacts waiting for one. */
  get waiting(): number {
    return this.#waiting.size;
  }

  enter(): BTPArrivalTicket {
    if (this.#inFlight < this.#maxInFlight) {
      this.#inFlight++;
      return { state: 'in', leave: this.#leave() };
    }
    if (this.#waiting.size >= this.#maxWaiting) return { state: 'full' };
    let wake!: (leave: BTPArrivalLeave | undefined) => void;
    const admitted = new Promise<BTPArrivalLeave | undefined>((resolve) => (wake = resolve));
    this.#waiting.add(wake);
    return {
      state: 'waiting',
      admitted,
      cancel: () => {
        if (this.#waiting.delete(wake)) wake(undefined);
      },
    };
  }

  /** A place's way out. A place given up goes straight to the first waiting, so none can pass it. */
  #leave(): BTPArrivalLeave {
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const next = this.#waiting.values().next();
      if (next.done) {
        this.#inFlight--;
        return;
      }
      this.#waiting.delete(next.value);
      next.value(this.#leave());
    };
  }
}

/**
 * The gate a server uses: none when `maxArtifactsInFlight` is not set, so it takes as many at once
 * as arrive, as before. A value it cannot use never stops the server: it is warned about and
 * replaced by 1 (in flight), 0 (waiting), or the default (waiting, when not a whole number).
 */
export const resolveArrivalGate = (
  maxArtifactsInFlight: number | undefined,
  maxArtifactsWaiting: number | undefined,
): BtpsArrivalGate | undefined => {
  if (maxArtifactsInFlight === undefined) {
    if (maxArtifactsWaiting !== undefined) {
      console.warn(
        '[BtpsServer] maxArtifactsWaiting is set without maxArtifactsInFlight; nothing waits until maxArtifactsInFlight is set',
      );
    }
    return undefined;
  }
  let inFlight = maxArtifactsInFlight;
  if (!Number.isInteger(inFlight) || inFlight < 1) {
    console.warn(
      `[BtpsServer] maxArtifactsInFlight ${inFlight} is not a whole number above 0; using 1`,
    );
    inFlight = 1;
  }
  let waiting = maxArtifactsWaiting ?? DEFAULT_MAX_ARTIFACTS_WAITING;
  if (!Number.isInteger(waiting)) {
    console.warn(
      `[BtpsServer] maxArtifactsWaiting ${waiting} is not a whole number; using the default ${DEFAULT_MAX_ARTIFACTS_WAITING}`,
    );
    waiting = DEFAULT_MAX_ARTIFACTS_WAITING;
  } else if (waiting < 0) {
    console.warn(`[BtpsServer] maxArtifactsWaiting ${waiting} is below the minimum 0; using 0`);
    waiting = 0;
  }
  return new BtpsArrivalGate(inFlight, waiting);
};
