import { z } from "zod"

import { MAX_FILES } from "@/lib/trades/constants"

export const tradeSideSchema = z.enum(["BUY", "SELL"])

const tradeAccountSchema = z.string().trim().min(1).nullable()

export const extractedTradeSchema = z.object({
  date: z
    .string()
    .min(1)
    .describe("Trade date in YYYY-MM-DD format when possible."),
  ticker: z
    .string()
    .min(1)
    .describe(
      "Security identifier, preferably a ticker or numeric stock code such as AAPL or 2330. If only a visible stock name is present, return that name."
    ),
  quantity: z
    .number()
    .finite()
    .positive()
    .describe("Positive trade quantity as a plain number."),
  price: z
    .number()
    .finite()
    .positive()
    .describe("Execution price per share or unit as a plain number."),
  currency: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe("Currency code if shown, otherwise null."),
  fee: z
    .number()
    .finite()
    .nonnegative()
    .nullable()
    .describe("Total fee or commission as a plain number, otherwise null."),
  side: tradeSideSchema.describe("Trade direction, always BUY or SELL."),
})

export const extractedTradesEnvelopeSchema = z.object({
  trades: z
    .array(extractedTradeSchema)
    .describe("Every distinct trade transaction found in the uploaded file."),
})

export function computeTradeTotalAmount({
  fee,
  price,
  quantity,
  side,
}: {
  fee: number | null
  price: number
  quantity: number
  side: z.infer<typeof tradeSideSchema>
}) {
  const baseAmount = quantity * price
  const signedFee = fee ?? 0
  const totalAmount =
    side === "BUY" ? baseAmount + signedFee : baseAmount - signedFee

  return Number(totalAmount.toFixed(8))
}

export const tradeFileSchema = z.object({
  type: z.literal("file"),
  url: z.string().min(1),
  mediaType: z.string().min(1),
  filename: z.string().trim().min(1).optional(),
})

export const extractTradesRequestSchema = z.object({
  prompt: z.string().max(1500).optional().default(""),
  files: z.array(tradeFileSchema).min(1).max(MAX_FILES),
})

export const fileExtractionResultSchema = z.object({
  fileName: z.string(),
  trades: z.array(extractedTradeSchema),
  error: z.string().nullable().optional(),
})

const tradeTableRowBaseSchema = extractedTradeSchema
  .omit({ fee: true })
  .extend({
    account: tradeAccountSchema,
    totalAmount: z
      .number()
      .finite()
      .nonnegative()
      .describe("Final trade amount including fees or commission."),
  })

const legacyTradeTableRowSchema = extractedTradeSchema.extend({
  account: tradeAccountSchema.optional(),
  id: z.string().min(1),
  sourceFile: z.string().min(1),
})

const accountlessTradeTableRowSchema = tradeTableRowBaseSchema.extend({
  account: tradeAccountSchema.optional(),
  id: z.string().min(1),
  sourceFile: z.string().min(1),
})

export const tradeTableRowSchema = tradeTableRowBaseSchema.extend({
  id: z.string().min(1),
  sourceFile: z.string().min(1),
})

export function normalizeTradeTableRow(
  row:
    | z.infer<typeof legacyTradeTableRowSchema>
    | z.infer<typeof accountlessTradeTableRowSchema>
    | TradeTableRow
): TradeTableRow {
  if ("totalAmount" in row) {
    return {
      ...row,
      account: row.account ?? null,
    }
  }

  return {
    account: row.account ?? null,
    currency: row.currency,
    date: row.date,
    id: row.id,
    price: row.price,
    quantity: row.quantity,
    side: row.side,
    sourceFile: row.sourceFile,
    ticker: row.ticker,
    totalAmount: computeTradeTotalAmount({
      fee: row.fee,
      price: row.price,
      quantity: row.quantity,
      side: row.side,
    }),
  }
}

export const storedTradeRowSchema = z
  .union([
    tradeTableRowSchema,
    accountlessTradeTableRowSchema,
    legacyTradeTableRowSchema,
  ])
  .transform(normalizeTradeTableRow)

export const extractTradesResponseSchema = z.object({
  results: z.array(fileExtractionResultSchema),
  rows: z.array(tradeTableRowSchema),
})

export const tradeRowsResponseSchema = z.object({
  rows: z.array(tradeTableRowSchema),
})

export type ExtractedTrade = z.infer<typeof extractedTradeSchema>
export type ExtractedTradesEnvelope = z.infer<
  typeof extractedTradesEnvelopeSchema
>
export type TradeFileInput = z.infer<typeof tradeFileSchema>
export type ExtractTradesRequest = z.infer<typeof extractTradesRequestSchema>
export type FileExtractionResult = z.infer<typeof fileExtractionResultSchema>
export type TradeTableRow = z.infer<typeof tradeTableRowSchema>
export type ExtractTradesResponse = z.infer<typeof extractTradesResponseSchema>
export type TradeRowsResponse = z.infer<typeof tradeRowsResponseSchema>
