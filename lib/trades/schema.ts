import { z } from "zod"

import { MAX_FILES } from "@/lib/trades/constants"

export const tradeSideSchema = z.enum(["BUY", "SELL"])

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

export const tradeTableRowSchema = extractedTradeSchema.extend({
  id: z.string().min(1),
  sourceFile: z.string().min(1),
})

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
