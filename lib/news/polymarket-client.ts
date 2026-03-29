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

export async function fetchActiveMarkets(
  limit: number = 20,
  fetcher: typeof fetch = fetch
): Promise<PredictionMarket[]> {
  try {
    const url = new URL(`${BASE_URL}/markets`)
    url.searchParams.set("active", "true")
    url.searchParams.set("closed", "false")
    url.searchParams.set("limit", String(limit))

    const response = await fetcher(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) return []

    const markets = (await response.json()) as Array<
      Record<string, unknown>
    >

    return markets.map((m) => ({
      id: (m.id as string) ?? "",
      question: (m.question as string) ?? "",
      slug: (m.slug as string) ?? "",
      outcomes: (m.outcomes as string[]) ?? [],
      outcomePrices: (m.outcomePrices as string[]) ?? [],
      volume: (m.volume as string) ?? "0",
      liquidity: (m.liquidity as string) ?? "0",
    }))
  } catch {
    return []
  }
}
