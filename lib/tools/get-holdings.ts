import { tool } from "ai"
import { z } from "zod"

import { getCurrentHoldings } from "@/lib/portfolio/current-holdings"

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
  execute: ({ account, ticker }) => getCurrentHoldings({ account, ticker }),
})
