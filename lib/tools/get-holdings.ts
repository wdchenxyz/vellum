import { tool } from "ai"
import { z } from "zod"

import {
  aggregateHoldings,
  applyPreviousCloseQuotes,
  inferSupportedMarket,
} from "@/lib/portfolio/holdings"
import type { PreviousCloseLookupTarget } from "@/lib/portfolio/schema"
import { fetchPreviousCloseSnapshots } from "@/lib/quotes/twelve-data"
import { readStoredTradeRows } from "@/lib/trades/storage"

export const getHoldings = tool({
  description:
    "Get current portfolio holdings with aggregated positions, market values, weights, and unrealized P&L. Each holding includes ticker, market (US/TW), quantity, average cost, previous close price, and market value. Holdings are grouped by account.",
  inputSchema: z.object({
    account: z
      .string()
      .optional()
      .describe("Filter by account name (case-insensitive partial match)"),
    ticker: z
      .string()
      .optional()
      .describe("Filter by ticker symbol (case-insensitive partial match)"),
  }),
  execute: async ({ account, ticker }) => {
    const trades = await readStoredTradeRows()

    if (trades.length === 0) {
      return { groups: [], totalHoldings: 0 }
    }

    const { holdings, issues } = aggregateHoldings(trades)

    if (holdings.length === 0) {
      return { groups: [], totalHoldings: 0, issues }
    }

    // Build quote targets from aggregated holdings.
    const quoteTargets: PreviousCloseLookupTarget[] = holdings.map(
      (holding) => ({
        ticker: holding.ticker,
        market: holding.market,
      })
    )

    const quotes = await fetchPreviousCloseSnapshots(quoteTargets)
    const quotesByKey: Record<string, (typeof quotes)[number]> = {}

    for (const quote of quotes) {
      quotesByKey[quote.key] = quote
    }

    const { groups } = applyPreviousCloseQuotes(holdings, quotesByKey)

    // Apply optional filters.
    const filteredGroups = groups
      .filter((group) => {
        if (
          account &&
          !(group.label ?? "")
            .toUpperCase()
            .includes(account.trim().toUpperCase())
        ) {
          return false
        }

        return true
      })
      .map((group) => {
        const filteredHoldings = group.holdings.filter((h) => {
          if (
            ticker &&
            !h.ticker.toUpperCase().includes(ticker.trim().toUpperCase())
          ) {
            return false
          }

          return true
        })

        return {
          account: group.label,
          currencies: group.currencies,
          totalCostOpen: group.totalCostOpen,
          totalMarketValue: group.totalMarketValue,
          missingPriceCount: group.missingPriceCount,
          holdings: filteredHoldings.map((h) => ({
            ticker: h.ticker,
            market: h.market,
            currency: h.currency,
            quantityOpen: h.quantityOpen,
            averageCost: h.averageCost,
            totalCostOpen: h.totalCostOpen,
            previousClose: h.previousClose,
            previousCloseDate: h.previousCloseDate,
            marketValue: h.marketValue,
            weight: h.weight,
            unrealizedPnl:
              h.marketValue !== null
                ? Math.round(h.marketValue - h.totalCostOpen)
                : null,
            unrealizedPnlPct:
              h.marketValue !== null && h.totalCostOpen > 0
                ? Number(
                    (
                      ((h.marketValue - h.totalCostOpen) / h.totalCostOpen) *
                      100
                    ).toFixed(2)
                  )
                : null,
          })),
        }
      })

    const totalHoldings = filteredGroups.reduce(
      (sum, g) => sum + g.holdings.length,
      0
    )

    return { groups: filteredGroups, totalHoldings, issues }
  },
})
