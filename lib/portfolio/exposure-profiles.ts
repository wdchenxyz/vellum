import { z } from "zod"

import { supportedMarketSchema } from "@/lib/portfolio/schema"

export const exposureDirectionSchema = z.enum(["long", "inverse"])

export const instrumentExposureProfileSchema = z.object({
  createdAt: z.string().nullable().optional(),
  exposureDirection: exposureDirectionSchema,
  exposureMultiplier: z.number().finite().positive(),
  instrumentName: z.string().trim().min(1).nullable(),
  market: supportedMarketSchema,
  notes: z.string().trim().min(1).nullable(),
  source: z.string().trim().min(1).nullable(),
  ticker: z.string().trim().min(1),
  underlyingMarket: supportedMarketSchema,
  underlyingTicker: z.string().trim().min(1),
  updatedAt: z.string().nullable().optional(),
})

export const upsertInstrumentExposureProfileSchema =
  instrumentExposureProfileSchema.omit({
    createdAt: true,
    updatedAt: true,
  })

export const exposureProfilesResponseSchema = z.object({
  profiles: z.array(instrumentExposureProfileSchema),
})

export type ExposureDirection = z.infer<typeof exposureDirectionSchema>
export type InstrumentExposureProfile = z.infer<
  typeof instrumentExposureProfileSchema
>
export type UpsertInstrumentExposureProfile = z.infer<
  typeof upsertInstrumentExposureProfileSchema
>

export const DEFAULT_EXPOSURE_PROFILES: UpsertInstrumentExposureProfile[] = [
  {
    exposureDirection: "long",
    exposureMultiplier: 2,
    instrumentName: "GraniteShares 2x Long AMD Daily ETF",
    market: "US",
    notes: null,
    source: "seed",
    ticker: "AMDL",
    underlyingMarket: "US",
    underlyingTicker: "AMD",
  },
  {
    exposureDirection: "long",
    exposureMultiplier: 2,
    instrumentName: "Direxion Daily GOOGL Bull 2X Shares",
    market: "US",
    notes: null,
    source: "seed",
    ticker: "GGLL",
    underlyingMarket: "US",
    underlyingTicker: "GOOGL",
  },
  {
    exposureDirection: "long",
    exposureMultiplier: 2,
    instrumentName: "Direxion Daily MU Bull 2X Shares",
    market: "US",
    notes: null,
    source: "seed",
    ticker: "MUU",
    underlyingMarket: "US",
    underlyingTicker: "MU",
  },
  {
    exposureDirection: "long",
    exposureMultiplier: 2,
    instrumentName: "GraniteShares 2x Long NVDA Daily ETF",
    market: "US",
    notes: null,
    source: "seed",
    ticker: "NVDL",
    underlyingMarket: "US",
    underlyingTicker: "NVDA",
  },
  {
    exposureDirection: "long",
    exposureMultiplier: 2,
    instrumentName: "Direxion Daily TSLA Bull 2X Shares",
    market: "US",
    notes: null,
    source: "seed",
    ticker: "TSLL",
    underlyingMarket: "US",
    underlyingTicker: "TSLA",
  },
]

export function getExposureProfileKey({
  market,
  ticker,
}: {
  market: InstrumentExposureProfile["market"]
  ticker: string
}) {
  return `${market}:${ticker.trim().toUpperCase()}`
}

export function normalizeExposureProfile(
  profile: UpsertInstrumentExposureProfile
): UpsertInstrumentExposureProfile {
  return {
    ...profile,
    instrumentName: profile.instrumentName?.trim() || null,
    notes: profile.notes?.trim() || null,
    source: profile.source?.trim() || null,
    ticker: profile.ticker.trim().toUpperCase(),
    underlyingTicker: profile.underlyingTicker.trim().toUpperCase(),
  }
}
