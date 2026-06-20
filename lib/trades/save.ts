import "server-only"

import { createHash } from "node:crypto"

import {
  computeTradeTotalAmount,
  saveReviewedTradesRequestSchema,
  type ReviewedTradeInput,
  type TradeTableRow,
} from "@/lib/trades/schema"
import { appendStoredTradeRowsIdempotently } from "@/lib/trades/storage"

export class InvalidSavedTradeRequestError extends Error {
  constructor(
    message = "A valid request ID and at least one trade are required."
  ) {
    super(message)
    this.name = "InvalidSavedTradeRequestError"
  }
}

function normalizeNullableString(value: string | null) {
  return value?.trim().toUpperCase() || null
}

function createSavedTradeId(requestId: string, index: number) {
  const digest = createHash("sha256")
    .update(`${requestId}:${index}`)
    .digest("hex")

  return `api-${digest}`
}

function hashTradePayload(rows: TradeTableRow[]) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex")
}

export function buildSavedTradeRows({
  idFactory = () => crypto.randomUUID(),
  trades,
}: {
  idFactory?: (trade: ReviewedTradeInput, index: number) => string
  trades: ReviewedTradeInput[]
}): TradeTableRow[] {
  return trades.map((trade, index) => ({
    account: trade.account?.trim() || null,
    currency: normalizeNullableString(trade.currency),
    date: trade.date.trim(),
    id: idFactory(trade, index),
    price: trade.price,
    quantity: trade.quantity,
    side: trade.side,
    sourceFile: trade.sourceFile.trim(),
    ticker: trade.ticker.trim().toUpperCase(),
    totalAmount:
      trade.settlementAmount ??
      computeTradeTotalAmount({
        fee: trade.fee,
        price: trade.price,
        quantity: trade.quantity,
        side: trade.side,
      }),
  }))
}

export async function saveReviewedTrades(body: unknown, databasePath?: string) {
  const parsed = saveReviewedTradesRequestSchema.safeParse(body)

  if (!parsed.success) {
    throw new InvalidSavedTradeRequestError()
  }

  const { requestId, trades } = parsed.data
  const rows = buildSavedTradeRows({
    idFactory: (_trade, index) => createSavedTradeId(requestId, index),
    trades,
  })

  return appendStoredTradeRowsIdempotently(
    {
      payloadHash: hashTradePayload(rows),
      requestId,
      rows,
    },
    databasePath
  )
}
