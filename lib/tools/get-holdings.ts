import { tool } from "ai"
import { z } from "zod"

import {
  aggregateHoldings,
  applyPreviousCloseQuotes,
} from "@/lib/portfolio/holdings"
import {
  buildAccountSummaries,
  getAccountSummaryStatus,
  getAccountSummaryValueMetrics,
} from "@/lib/portfolio/summary-cards"
import type {
  FxRateSnapshot,
  PreviousCloseLookupTarget,
  SupportedMarket,
} from "@/lib/portfolio/schema"
import {
  fetchPreviousCloseSnapshots,
  fetchUsdTwdFxSnapshot,
} from "@/lib/quotes/twelve-data"
import { readStoredTradeRows } from "@/lib/trades/storage"

type PreviousCloseQuote = Awaited<
  ReturnType<typeof fetchPreviousCloseSnapshots>
>[number]
type HoldingGroup = ReturnType<
  typeof applyPreviousCloseQuotes
>["groups"][number]
type ValuedHolding = HoldingGroup["holdings"][number]

function normalizeFilter(value: string | undefined) {
  return value?.trim().toUpperCase() || null
}

function buildQuoteTargets(
  holdings: Array<{ ticker: string; market: SupportedMarket }>
) {
  return holdings.map(
    (holding): PreviousCloseLookupTarget => ({
      ticker: holding.ticker,
      market: holding.market,
    })
  )
}

function buildQuotesByKey(quotes: PreviousCloseQuote[]) {
  const quotesByKey: Record<string, PreviousCloseQuote> = {}

  for (const quote of quotes) {
    quotesByKey[quote.key] = quote
  }

  return quotesByKey
}

function matchesGroupFilter(group: HoldingGroup, accountFilter: string | null) {
  if (!accountFilter) {
    return true
  }

  return (group.label ?? "").toUpperCase().includes(accountFilter)
}

function matchesHoldingFilter(
  holding: ValuedHolding,
  tickerFilter: string | null
) {
  if (!tickerFilter) {
    return true
  }

  return holding.ticker.toUpperCase().includes(tickerFilter)
}

function buildHoldingResponse(holding: ValuedHolding) {
  const unrealizedPnl =
    holding.marketValue !== null
      ? Math.round(holding.marketValue - holding.totalCostOpen)
      : null
  const unrealizedPnlPct =
    holding.marketValue !== null && holding.totalCostOpen > 0
      ? Number(
          (
            ((holding.marketValue - holding.totalCostOpen) /
              holding.totalCostOpen) *
            100
          ).toFixed(2)
        )
      : null

  return {
    ticker: holding.ticker,
    market: holding.market,
    currency: holding.currency,
    quantityOpen: holding.quantityOpen,
    averageCost: holding.averageCost,
    totalCostOpen: holding.totalCostOpen,
    previousClose: holding.previousClose,
    previousCloseDate: holding.previousCloseDate,
    marketValue: holding.marketValue,
    weight: holding.weight,
    unrealizedPnl,
    unrealizedPnlPct,
  }
}

function summarizeFilteredGroup(holdings: ValuedHolding[]) {
  const currencies = [...new Set(holdings.map((holding) => holding.currency))]
  const singleCurrency = currencies.length === 1 ? currencies[0] : null
  const totalCostOpen = singleCurrency
    ? holdings.reduce((sum, holding) => sum + holding.totalCostOpen, 0)
    : null
  const missingPriceCount = holdings.filter(
    (holding) => holding.marketValue === null
  ).length
  const totalMarketValue =
    singleCurrency && missingPriceCount === 0
      ? holdings.reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0)
      : null

  return {
    currencies,
    missingPriceCount,
    totalCostOpen,
    totalMarketValue,
  }
}

function getRoundedPercent(value: number | null) {
  if (value === null) {
    return null
  }

  return Number((value * 100).toFixed(2))
}

function buildGroupValuationSummary(
  holdings: ValuedHolding[],
  fxSnapshot: FxRateSnapshot | null
) {
  const [summary] = buildAccountSummaries(holdings, fxSnapshot)

  if (!summary) {
    return {
      displayCurrency: null,
      netValueChangePct: null,
      netValueChangeTwd: null,
      totalCostBasisTwd: null,
      totalMarketValueTwd: null,
      valuationStatus: null,
    }
  }

  const valueMetrics = getAccountSummaryValueMetrics(summary, fxSnapshot)

  return {
    displayCurrency: summary.displayCurrency,
    netValueChangePct: getRoundedPercent(valueMetrics.changeRatio),
    netValueChangeTwd: valueMetrics.changeAmountTwd,
    totalCostBasisTwd: valueMetrics.costTwd,
    totalMarketValueTwd: valueMetrics.marketValueTwd,
    valuationStatus: getAccountSummaryStatus(summary),
  }
}

function buildMatchedGroups({
  account,
  groups,
  ticker,
}: {
  account: string | undefined
  groups: HoldingGroup[]
  ticker: string | undefined
}) {
  const accountFilter = normalizeFilter(account)
  const tickerFilter = normalizeFilter(ticker)

  return groups
    .filter((group) => matchesGroupFilter(group, accountFilter))
    .map((group) => ({
      ...group,
      holdings: group.holdings.filter((holding) =>
        matchesHoldingFilter(holding, tickerFilter)
      ),
    }))
    .filter((group) => group.holdings.length > 0)
}

async function fetchFxSnapshotIfNeeded(groups: HoldingGroup[]) {
  const hasUsdHoldings = groups.some((group) =>
    group.holdings.some((holding) => holding.currency === "USD")
  )

  if (!hasUsdHoldings) {
    return null
  }

  try {
    return await fetchUsdTwdFxSnapshot()
  } catch {
    return null
  }
}

function filterAndShapeGroups({
  fxSnapshot,
  groups,
}: {
  fxSnapshot: FxRateSnapshot | null
  groups: HoldingGroup[]
}) {
  return groups
    .map((group) => {
      const summary = summarizeFilteredGroup(group.holdings)
      const valuation = buildGroupValuationSummary(group.holdings, fxSnapshot)

      return {
        account: group.label,
        currencies: summary.currencies,
        displayCurrency: valuation.displayCurrency,
        netValueChangePct: valuation.netValueChangePct,
        netValueChangeTwd: valuation.netValueChangeTwd,
        totalCostOpen: summary.totalCostOpen,
        totalCostBasisTwd: valuation.totalCostBasisTwd,
        totalMarketValue: summary.totalMarketValue,
        totalMarketValueTwd: valuation.totalMarketValueTwd,
        missingPriceCount: summary.missingPriceCount,
        valuationStatus: valuation.valuationStatus,
        holdings: group.holdings.map(buildHoldingResponse),
      }
    })
}

function countHoldings(groups: Array<{ holdings: unknown[] }>) {
  return groups.reduce((sum, group) => sum + group.holdings.length, 0)
}

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

    const quoteTargets = buildQuoteTargets(holdings)
    const quotes = await fetchPreviousCloseSnapshots(quoteTargets)
    const quotesByKey = buildQuotesByKey(quotes)

    const { groups } = applyPreviousCloseQuotes(holdings, quotesByKey)
    const matchedGroups = buildMatchedGroups({ account, groups, ticker })
    const fxSnapshot = await fetchFxSnapshotIfNeeded(matchedGroups)
    const filteredGroups = filterAndShapeGroups({
      fxSnapshot,
      groups: matchedGroups,
    })
    const totalHoldings = countHoldings(filteredGroups)

    return { groups: filteredGroups, totalHoldings, issues }
  },
})
