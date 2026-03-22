import { tool } from "ai"
import { z } from "zod"

import { readStoredTradeRows } from "@/lib/trades/storage"

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

    const filtered = allRows.filter((row) => {
      if (
        ticker &&
        !row.ticker.toUpperCase().includes(ticker.trim().toUpperCase())
      ) {
        return false
      }

      if (
        account &&
        !(row.account ?? "")
          .toUpperCase()
          .includes(account.trim().toUpperCase())
      ) {
        return false
      }

      if (dateFrom && row.date < dateFrom) {
        return false
      }

      if (dateTo && row.date > dateTo) {
        return false
      }

      if (side && row.side !== side) {
        return false
      }

      return true
    })

    return {
      count: filtered.length,
      trades: filtered.map((row) => ({
        id: row.id,
        date: row.date,
        ticker: row.ticker,
        side: row.side,
        quantity: row.quantity,
        price: row.price,
        currency: row.currency,
        totalAmount: row.totalAmount,
        account: row.account,
      })),
    }
  },
})
