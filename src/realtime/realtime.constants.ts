/**
 * Realtime channel + WebSocket close codes (design #1471, spec REQ-1/REQ-4).
 *
 * A single Redis pub/sub channel carries every `activity.*` transition as an
 * `activity.changed` signal (REQ-2). The two close codes are application-level
 * (4000–4999 range is reserved for private use by RFC 6455) so the client can
 * distinguish "retry with a fresh token" (4401) from "no active membership"
 * (4403).
 */

/** Redis pub/sub channel shared by the worker publisher and the API subscriber. */
export const REALTIME_CHANNEL = 'realtime:activities';

/** Handshake missing/invalid/expired JWT (spec REQ-1). */
export const WS_CLOSE_UNAUTHORIZED = 4401;

/** Verified JWT but the user has no active bond membership (spec REQ-1). */
export const WS_CLOSE_NO_MEMBERSHIP = 4403;
