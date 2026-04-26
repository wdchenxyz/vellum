import { describe, expect, it } from "vitest"

import { dailyValuesResponseSchema } from "@/lib/portfolio/schema"

describe("dailyValuesResponseSchema", () => {
  it("defaults a missing cost basis to null instead of zero", () => {
    const parsed = dailyValuesResponseSchema.parse({
      series: [{ date: "2026-04-03", value: 12345 }],
    })

    expect(parsed.costBasisTwd).toBeNull()
  })
})
