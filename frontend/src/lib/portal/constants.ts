// Idle sign-out timing for the portal (TDD 4.3.2, 4.6.1).

// Must match `session_idle_minutes` in backend/app/config.py. The 30 minutes is still an open
// question (TDD open question 9), so change it only here and in the backend setting.
export const IDLE_TIMEOUT_MINUTES = 30;
export const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60_000;

// How long before sign-out the warning dialog opens.
export const IDLE_WARNING_MINUTES = 2;
export const IDLE_WARNING_MS = IDLE_WARNING_MINUTES * 60_000;

// Shown on the sign-in page after an idle sign-out (/portal/sign-in?reason=idle).
export const IDLE_SIGN_OUT_MESSAGE = `You were signed out after ${IDLE_TIMEOUT_MINUTES} minutes of inactivity.`;
