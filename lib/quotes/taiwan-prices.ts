import "server-only"

import { z } from "zod"

const FINMIND_DATA_URL = "https://api.finmindtrade.com/api/v4/data"

const finMindTaiwanPriceResponseSchema = z.object({
  data: z
    .array(
      z.object({
        close: z.number(),
        date: z.string(),
        stock_id: z.string(),
      })
    )
    .default([]),
  msg: z.string().optional(),
  status: z.union([z.number(), z.string()]).optional(),
})

function getRecentTaiwanStartDate() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - 40)
  return date.toISOString().slice(0, 10)
}

export async function fetchTaiwanPreviousClose(
  symbol: string,
  fetcher: typeof fetch = fetch
) {
  const url = new URL(FINMIND_DATA_URL)
  url.searchParams.set("dataset", "TaiwanStockPrice")
  url.searchParams.set("data_id", symbol.trim().toUpperCase())
  url.searchParams.set("start_date", getRecentTaiwanStartDate())

  const response = await fetcher(url, {
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Unable to load Taiwan daily prices for ${symbol}.`)
  }

  const payload = await response.json().catch(() => null)
  const parsed = finMindTaiwanPriceResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("Taiwan daily prices are invalid.")
  }

  const latestQuote = parsed.data.data.at(-1)

  if (!latestQuote) {
    throw new Error(`No Taiwan daily close was found for ${symbol}.`)
  }

  return {
    asOf: latestQuote.date,
    previousClose: latestQuote.close,
  }
}

export const fetchTwsePreviousClose = fetchTaiwanPreviousClose
