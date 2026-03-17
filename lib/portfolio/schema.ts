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

export type SupportedMarket = z.infer<typeof supportedMarketSchema>
export type PreviousCloseLookupTarget = z.infer<
  typeof previousCloseLookupTargetSchema
>
export type PreviousCloseRequest = z.infer<typeof previousCloseRequestSchema>
export type PreviousCloseQuote = z.infer<typeof previousCloseQuoteSchema>
export type PreviousCloseResponse = z.infer<typeof previousCloseResponseSchema>
