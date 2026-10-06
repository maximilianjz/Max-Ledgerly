// A best-effort guard per server instance. The assessment uses a random,
// high-entropy password; this is not a distributed production rate limiter.
let attempts: number[] = [];
const WINDOW_MS = 60_000;

export function allowLoginAttempt(now = Date.now()) {
  attempts = attempts.filter((time) => now - time < WINDOW_MS);
  if (attempts.length >= 10) return false;
  attempts.push(now);
  return true;
}
