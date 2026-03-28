import "server-only"

const JINA_BASE_URL = "https://r.jina.ai/"
const MIN_INTERVAL_MS = 3000 // 3 seconds between requests

// WeakMap keyed on the fetcher so injected test fns each get isolated rate
// limit state, while production always uses the same global `fetch` reference.
const lastRequestTimeByFetcher = new WeakMap<typeof fetch, number>()

async function waitForRateLimit(fetcher: typeof fetch): Promise<void> {
  const lastRequestTime = lastRequestTimeByFetcher.get(fetcher) ?? 0
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_INTERVAL_MS - elapsed)
    )
  }
  lastRequestTimeByFetcher.set(fetcher, Date.now())
}

export async function extractContent(
  url: string,
  fetcher: typeof fetch = fetch
): Promise<string | null> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return null
  }

  await waitForRateLimit(fetcher)

  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json",
    }

    const apiKey = process.env.JINA_API_KEY
    if (apiKey?.trim()) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await fetcher(`${JINA_BASE_URL}${url}`, {
      headers,
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) return null

    const data = (await response.json()) as {
      data?: { content?: string }
    }

    return data.data?.content ?? null
  } catch {
    return null
  }
}
