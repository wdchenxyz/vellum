import "server-only"

const BASE_URL = "https://newsnow.busiyi.world"
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export interface NewsItem {
  id: string
  source: string
  rank: number
  title: string
  url: string
  publishTime?: string
  metadata: Record<string, unknown>
}

interface CacheEntry {
  time: number
  data: NewsItem[]
}

// WeakMap keyed on the fetcher so injected test fns each get isolated caches,
// while production always uses the same global `fetch` reference.
const cachesByFetcher = new WeakMap<
  typeof fetch,
  Map<string, CacheEntry>
>()

function getCacheFor(fetcher: typeof fetch): Map<string, CacheEntry> {
  let cache = cachesByFetcher.get(fetcher)
  if (!cache) {
    cache = new Map()
    cachesByFetcher.set(fetcher, cache)
  }
  return cache
}

export async function fetchHotNewsFromSource(
  sourceId: string,
  count: number = 15,
  fetcher: typeof fetch = fetch
): Promise<NewsItem[]> {
  const cache = getCacheFor(fetcher)
  const cacheKey = `${sourceId}_${count}`
  const cached = cache.get(cacheKey)
  const now = Date.now()

  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.data
  }

  try {
    const response = await fetcher(
      `${BASE_URL}/api/s?id=${encodeURIComponent(sourceId)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(30_000),
      }
    )

    if (!response.ok) {
      if (cached) return cached.data
      return []
    }

    const data = (await response.json()) as {
      items?: Array<{
        id?: string
        title?: string
        url?: string
        publish_time?: string
        extra?: Record<string, unknown>
      }>
    }

    const items = (data.items ?? []).slice(0, count)
    const processed: NewsItem[] = items.map((item, i) => ({
      id: item.id ?? `${sourceId}_${now}_${i + 1}`,
      source: sourceId,
      rank: i + 1,
      title: item.title ?? "",
      url: item.url ?? "",
      publishTime: item.publish_time,
      metadata: item.extra ?? {},
    }))

    cache.set(cacheKey, { time: now, data: processed })
    return processed
  } catch {
    if (cached) return cached.data
    return []
  }
}
