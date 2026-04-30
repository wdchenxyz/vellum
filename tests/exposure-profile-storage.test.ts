import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  readInstrumentExposureProfiles,
  upsertInstrumentExposureProfile,
} from "@/lib/portfolio/exposure-profile-storage"
import { getTradeStoreDatabasePath } from "@/lib/trades/storage"

const tempDirectories: string[] = []

async function createTempStorePath() {
  const directory = await mkdtemp(path.join(tmpdir(), "vellum-exposure-"))
  tempDirectories.push(directory)
  return getTradeStoreDatabasePath(directory)
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("exposure profile storage", () => {
  it("seeds default exposure profiles on first read", async () => {
    const databasePath = await createTempStorePath()

    const profiles = await readInstrumentExposureProfiles(databasePath)

    expect(
      profiles.map((profile) => ({
        multiplier: profile.exposureMultiplier,
        ticker: profile.ticker,
        underlying: profile.underlyingTicker,
      }))
    ).toEqual([
      { multiplier: 2, ticker: "AMDL", underlying: "AMD" },
      { multiplier: 2, ticker: "GGLL", underlying: "GOOGL" },
      { multiplier: 2, ticker: "MUU", underlying: "MU" },
      { multiplier: 2, ticker: "NVDL", underlying: "NVDA" },
      { multiplier: 2, ticker: "TSLL", underlying: "TSLA" },
    ])
  })

  it("upserts a user-reviewed exposure profile", async () => {
    const databasePath = await createTempStorePath()

    const profile = await upsertInstrumentExposureProfile(
      {
        exposureDirection: "long",
        exposureMultiplier: 2,
        instrumentName: "Example 2x Long ETF",
        market: "US",
        notes: "User verified from issuer page.",
        reviewStatus: "reviewed",
        source: "user",
        ticker: " abcl ",
        underlyingMarket: "US",
        underlyingTicker: " abc ",
      },
      databasePath
    )

    expect(profile).toMatchObject({
      exposureDirection: "long",
      exposureMultiplier: 2,
      instrumentName: "Example 2x Long ETF",
      market: "US",
      notes: "User verified from issuer page.",
      reviewStatus: "reviewed",
      source: "user",
      ticker: "ABCL",
      underlyingMarket: "US",
      underlyingTicker: "ABC",
    })

    const profiles = await readInstrumentExposureProfiles(databasePath)

    expect(
      profiles.find((candidate) => candidate.ticker === "ABCL")
    ).toMatchObject({
      exposureMultiplier: 2,
      underlyingTicker: "ABC",
    })
  })
})
