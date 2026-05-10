import { SessionState } from '../types.js';

const store = new Map<string, SessionState>();

export function getSessionState(sessionId: string): SessionState {
  return store.get(sessionId) ?? { candidate_slots: [], auth_state: 'unknown' };
}

export function patchSessionState(sessionId: string, patch: Partial<SessionState>): SessionState {
  const next = { ...getSessionState(sessionId), ...patch };
  if (patch.candidate_slots) next.candidate_slots = patch.candidate_slots;
  store.set(sessionId, next);
  return next;
}
