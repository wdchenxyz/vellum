import { tool } from "ai"
import { z } from "zod"

import { fetchActiveMarkets } from "@/lib/news/polymarket-client"

export const getMarketSummary = tool({
  description:
    "Get a summary of active prediction markets from Polymarket. Returns questions, outcome probabilities, and trading volume. Use this when the user asks about prediction markets, public sentiment, or probability of events.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe("Number of markets to return (1-50, default 10)"),
  }),
  execute: async ({ limit }) => {
    const markets = await fetchActiveMarkets(limit)

    return {
      count: markets.length,
      markets: markets.map((m, i) => ({
        rank: i + 1,
        question: m.question,
        outcomes: m.outcomes,
        outcomePrices: m.outcomePrices,
        volume: m.volume,
      })),
    }
  },
})
