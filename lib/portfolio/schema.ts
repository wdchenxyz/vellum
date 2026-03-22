import { z } from "zod"

export const supportedMarketSchema = z.enum(["US", "TW"])

export const previousCloseLookupTargetSchema = z.object({
  ticker: z.string().trim().min(1),
  market: supportedMarketSchema,
})

export const previousCloseRequestSchema = z.object({
  targets: z.array(previousCloseLookupTargetSchema).min(1).max(40),
})

export const previousCloseQuoteSchema = z.object({
  key: z.string().min(1),
  ticker: z.string().min(1),
  market: supportedMarketSchema,
  exchange: z.string().nullable(),
  micCode: z.string().nullable(),
  currency: z.string().nullable(),
  previousClose: z.number().finite().nonnegative().nullable(),
  asOf: z.string().nullable(),
  error: z.string().nullable().optional(),
})

export const previousCloseResponseSchema = z.object({
  quotes: z.array(previousCloseQuoteSchema),
})

export const fxRateSnapshotSchema = z.object({
  asOf: z.string().nullable(),
  pair: z.string().min(1),
  rate: z.number().finite().positive(),
})

export const fxRateResponseSchema = z.object({
  snapshot: fxRateSnapshotSchema,
})

export type SupportedMarket = z.infer<typeof supportedMarketSchema>
export type PreviousCloseLookupTarget = z.infer<
  typeof previousCloseLookupTargetSchema
>
export type PreviousCloseRequest = z.infer<typeof previousCloseRequestSchema>
export type PreviousCloseQuote = z.infer<typeof previousCloseQuoteSchema>
export type PreviousCloseResponse = z.infer<typeof previousCloseResponseSchema>
export const dailyValuePointSchema = z.object({
  date: z.string().min(1),
  value: z.number().finite(),
})

export const dailyValuesResponseSchema = z.object({
  series: z.array(dailyValuePointSchema),
})

export type DailyValuePoint = z.infer<typeof dailyValuePointSchema>
export type DailyValuesResponse = z.infer<typeof dailyValuesResponseSchema>
export type FxRateSnapshot = z.infer<typeof fxRateSnapshotSchema>
export type FxRateResponse = z.infer<typeof fxRateResponseSchema>
