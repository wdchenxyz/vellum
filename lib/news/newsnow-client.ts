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

interface RawNewsItem {
  id?: string
  title?: string
  url?: string
  publish_time?: string
  extra?: Record<string, unknown>
}

// WeakMap keyed on the fetcher so injected test fns each get isolated caches,
// while production always uses the same global `fetch` reference.
const cachesByFetcher = new WeakMap<typeof fetch, Map<string, CacheEntry>>()

function getCacheFor(fetcher: typeof fetch): Map<string, CacheEntry> {
  let cache = cachesByFetcher.get(fetcher)
  if (!cache) {
    cache = new Map()
    cachesByFetcher.set(fetcher, cache)
  }
  return cache
}

function getCacheKey(sourceId: string, count: number) {
  return `${sourceId}_${count}`
}

function hasFreshCache(
  entry: CacheEntry | undefined,
  now: number
): entry is CacheEntry {
  return Boolean(entry && now - entry.time < CACHE_TTL_MS)
}

function getRequestUrl(sourceId: string) {
  return `${BASE_URL}/api/s?id=${encodeURIComponent(sourceId)}`
}

function getRequestInit(): RequestInit {
  return {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(30_000),
  }
}

async function fetchSourceItems(sourceId: string, fetcher: typeof fetch) {
  const response = await fetcher(getRequestUrl(sourceId), getRequestInit())

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as {
    items?: RawNewsItem[]
  }

  return data.items ?? []
}

function normalizeNewsItems(
  items: RawNewsItem[],
  sourceId: string,
  count: number,
  now: number
): NewsItem[] {
  return items.slice(0, count).map((item, index) => ({
    id: item.id ?? `${sourceId}_${now}_${index + 1}`,
    source: sourceId,
    rank: index + 1,
    title: item.title ?? "",
    url: item.url ?? "",
    publishTime: item.publish_time,
    metadata: item.extra ?? {},
  }))
}

function getFallbackItems(cached: CacheEntry | undefined) {
  return cached?.data ?? []
}

export async function fetchHotNewsFromSource(
  sourceId: string,
  count: number = 15,
  fetcher: typeof fetch = fetch
): Promise<NewsItem[]> {
  const cache = getCacheFor(fetcher)
  const cacheKey = getCacheKey(sourceId, count)
  const cached = cache.get(cacheKey)
  const now = Date.now()

  if (hasFreshCache(cached, now)) {
    return cached.data
  }

  try {
    const items = await fetchSourceItems(sourceId, fetcher)

    if (!items) {
      return getFallbackItems(cached)
    }

    const processed = normalizeNewsItems(items, sourceId, count, now)

    cache.set(cacheKey, { time: now, data: processed })
    return processed
  } catch {
    return getFallbackItems(cached)
  }
}
