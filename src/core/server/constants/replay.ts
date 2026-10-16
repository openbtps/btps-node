/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Replay protection (BTPS 1.1). See the
 * "Replay protection" section of the transporter artifact specification.
 */

/**
 * How far a signed artifact's `issuedAt` may be from the receiving server's
 * clock, either way: ±5 minutes. Both ends are inclusive: exactly 5:00 old
 * or 5:00 ahead is accepted, 5:00.001 is refused.
 */
export const ISSUED_AT_WINDOW_MS = 5 * 60 * 1000;

/**
 * The widest window a server may configure. It is the protocol window
 * itself: a server may make it tighter, never wider, so an artifact one
 * server refuses as too old is refused by every server.
 */
export const MAX_ISSUED_AT_WINDOW_MS = ISSUED_AT_WINDOW_MS;

/** How many accepted `(from, id)` pairs the in-memory replay store holds by default. */
export const REPLAY_STORE_DEFAULT_MAX_ENTRIES = 100_000;
