import { tool } from "ai"
import { z } from "zod"

import type { TradeTableRow } from "@/lib/trades/schema"
import { readStoredTradeRows } from "@/lib/trades/storage"

type TradeHistoryFilters = {
  account?: string
  dateFrom?: string
  dateTo?: string
  side?: "BUY" | "SELL"
  ticker?: string
}

function normalizeFilterValue(value?: string) {
  const normalizedValue = value?.trim().toUpperCase()
  return normalizedValue ? normalizedValue : undefined
}

function buildTradeHistoryFilters(filters: TradeHistoryFilters) {
  return {
    ticker: normalizeFilterValue(filters.ticker),
    account: normalizeFilterValue(filters.account),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    side: filters.side,
  }
}

function buildTradeHistoryPredicates(
  filters: ReturnType<typeof buildTradeHistoryFilters>
) {
  return [
    filters.ticker
      ? (row: TradeTableRow) =>
          row.ticker.toUpperCase().includes(filters.ticker!)
      : null,
    filters.account
      ? (row: TradeTableRow) =>
          (row.account ?? "").toUpperCase().includes(filters.account!)
      : null,
    filters.dateFrom
      ? (row: TradeTableRow) => row.date >= filters.dateFrom!
      : null,
    filters.dateTo ? (row: TradeTableRow) => row.date <= filters.dateTo! : null,
    filters.side ? (row: TradeTableRow) => row.side === filters.side : null,
  ].filter((predicate): predicate is (row: TradeTableRow) => boolean =>
    Boolean(predicate)
  )
}

function shapeTradeHistoryRow(row: TradeTableRow) {
  return {
    id: row.id,
    date: row.date,
    ticker: row.ticker,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    currency: row.currency,
    totalAmount: row.totalAmount,
    account: row.account,
  }
}

export const getTradeHistory = tool({
  description:
    "Get the user's trade history. Returns trade rows (BUY/SELL) with date, ticker, quantity, price, currency, account, and total amount. Supports optional filters by ticker, account, date range, and side.",
  inputSchema: z.object({
    ticker: z
      .string()
      .optional()
      .describe("Filter by ticker symbol (case-insensitive partial match)"),
    account: z
      .string()
      .optional()
      .describe("Filter by account name (case-insensitive partial match)"),
    dateFrom: z
      .string()
      .optional()
      .describe("Start date inclusive (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date inclusive (YYYY-MM-DD)"),
    side: z.enum(["BUY", "SELL"]).optional().describe("Filter by trade side"),
  }),
  execute: async ({ ticker, account, dateFrom, dateTo, side }) => {
    const allRows = await readStoredTradeRows()
    const filters = buildTradeHistoryFilters({
      ticker,
      account,
      dateFrom,
      dateTo,
      side,
    })
    const predicates = buildTradeHistoryPredicates(filters)
    const filtered = allRows.filter((row) =>
      predicates.every((predicate) => predicate(row))
    )

    return {
      count: filtered.length,
      trades: filtered.map(shapeTradeHistoryRow),
    }
  },
})
