import "server-only"

const BASE_URL = "https://gamma-api.polymarket.com"

export interface PredictionMarket {
  id: string
  question: string
  slug: string
  outcomes: string[]
  outcomePrices: string[]
  volume: string
  liquidity: string
}

function buildMarketsUrl(limit: number) {
  const url = new URL(`${BASE_URL}/markets`)
  url.searchParams.set("active", "true")
  url.searchParams.set("closed", "false")
  url.searchParams.set("limit", String(limit))
  return url.toString()
}

function getRequestInit(): RequestInit {
  return {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  }
}

function normalizeMarket(market: Record<string, unknown>): PredictionMarket {
  return {
    id: (market.id as string) ?? "",
    question: (market.question as string) ?? "",
    slug: (market.slug as string) ?? "",
    outcomes: (market.outcomes as string[]) ?? [],
    outcomePrices: (market.outcomePrices as string[]) ?? [],
    volume: (market.volume as string) ?? "0",
    liquidity: (market.liquidity as string) ?? "0",
  }
}

async function fetchMarkets(
  limit: number,
  fetcher: typeof fetch
): Promise<Array<Record<string, unknown>>> {
  const response = await fetcher(buildMarketsUrl(limit), getRequestInit())

  if (!response.ok) {
    return []
  }

  return (await response.json()) as Array<Record<string, unknown>>
}

export async function fetchActiveMarkets(
  limit: number = 20,
  fetcher: typeof fetch = fetch
): Promise<PredictionMarket[]> {
  try {
    const markets = await fetchMarkets(limit, fetcher)
    return markets.map(normalizeMarket)
  } catch {
    return []
  }
}
