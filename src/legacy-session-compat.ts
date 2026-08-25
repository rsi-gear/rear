/**
 * Read compatibility for Session events written by pre-Gear Rear releases.
 * @module dsh-plugin-rear/legacy-session-compat
 */

import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'

/**
 * Old Rear versions used this log-only event to link a Session to the former
 * refinement sidecar. It never changed conversation replay semantics, so the
 * Gear-backed runtime can safely recognize and otherwise ignore it.
 *
 * DSH 0.1.1-rc.2 still exposes no downstream event-registration API. Its
 * exported catalog is a Set at runtime even though the public type is readonly.
 * Register at module evaluation so persistence can accept historical logs
 * before a Session is restored; current Rear never appends this event.
 */
(KNOWN_SESSION_EVENT_TYPES as Set<string>).add('refinement/created')
