/**
 * The delay of every mocked answer (src/test/setup.ts, card e91dc528). 0 brings back the instant answer for a local
 * comparison run. A constant, not an environment variable: the repo's env-template guard requires every variable the
 * code reads in the deployment templates, and a test-only knob has no place there.
 */
export const SLOW_MOCK_MS: number = 10;
