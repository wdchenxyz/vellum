import { beforeEach, describe, expect, it, vi } from "vitest"

import type { InstrumentExposureProfile } from "@/lib/portfolio/exposure-profiles"

const mocks = vi.hoisted(() => ({
  readInstrumentExposureProfiles: vi.fn(),
  upsertInstrumentExposureProfile: vi.fn(),
}))

vi.mock("@/lib/portfolio/exposure-profile-storage", () => mocks)

const { POST } = await import("@/app/api/portfolio/exposure-profiles/route")

const savedProfile: InstrumentExposureProfile = {
  createdAt: "2026-05-02 00:00:00",
  exposureDirection: "long",
  exposureMultiplier: 2,
  instrumentName: "Example profile",
  market: "US",
  notes: "Set from test.",
  source: "user",
  ticker: "NEWL",
  underlyingMarket: "US",
  underlyingTicker: "NVDA",
  updatedAt: "2026-05-02 00:00:00",
}

function createPostRequest(payload: unknown) {
  return new Request("http://localhost/api/portfolio/exposure-profiles", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("POST /api/portfolio/exposure-profiles", () => {
  it("upserts an exposure profile and forces user source", async () => {
    mocks.upsertInstrumentExposureProfile.mockResolvedValue(savedProfile)

    const response = await POST(
      createPostRequest({
        exposureDirection: "long",
        exposureMultiplier: 2,
        instrumentName: "Example profile",
        market: "US",
        notes: "Set from test.",
        source: "seed",
        ticker: "newl",
        underlyingMarket: "US",
        underlyingTicker: "nvda",
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.upsertInstrumentExposureProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        exposureMultiplier: 2,
        source: "user",
        ticker: "newl",
        underlyingTicker: "nvda",
      })
    )
    await expect(response.json()).resolves.toEqual({ profile: savedProfile })
  })

  it("rejects invalid exposure profile payloads", async () => {
    const response = await POST(createPostRequest({ ticker: "" }))

    expect(response.status).toBe(400)
    expect(mocks.upsertInstrumentExposureProfile).not.toHaveBeenCalled()
  })
})
