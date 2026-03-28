import "server-only"

/**
 * Serial queue that processes async tasks one at a time with a configurable
 * delay between each. Prevents Twelve Data rate-limit errors on the free tier.
 *
 * Set TWELVEDATA_REQUEST_DELAY_MS=0 for paid tiers (parallel behaviour).
 */

const DEFAULT_DELAY_MS = 8_000

function getDelayMs() {
  const envValue = process.env.TWELVEDATA_REQUEST_DELAY_MS

  if (envValue !== undefined) {
    const parsed = Number(envValue)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DELAY_MS
  }

  return DEFAULT_DELAY_MS
}

let queue: Promise<void> = Promise.resolve()

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Enqueue a task. When the delay is 0, tasks run immediately (no queuing).
 * Otherwise, tasks run sequentially with a delay between each.
 */
export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const delayMs = getDelayMs()

  if (delayMs === 0) {
    return task()
  }

  const pending = queue
    .then(() => task())
    .finally(() => sleep(delayMs))

  // Keep the queue chain alive regardless of success/failure.
  queue = pending.then(
    () => undefined,
    () => undefined
  )

  return pending
}
