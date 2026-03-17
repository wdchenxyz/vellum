import { describe, expect, it } from "vitest"

import { buildPortfolioWeightChartSummary } from "@/lib/portfolio/weight-chart"

describe("buildPortfolioWeightChartSummary", () => {
  it("recalculates active weights across both buckets using the USD/TWD rate", () => {
    const result = buildPortfolioWeightChartSummary({
      activeBuckets: ["TWD", "USD"],
      holdings: [
        {
          bucket: "TWD",
          costBasis: 280000,
          key: "TW:2313",
          marketValue: 320000,
        },
        { bucket: "USD", costBasis: 800, key: "US:ASTS", marketValue: 1000 },
      ],
      usdTwdRate: 32,
    })

    expect(result.baseCurrency).toBe("TWD")
    expect(result.bars).toEqual([
      {
        activeWeight: 0.909091,
        allWeight: 0.909091,
        convertedCostBasis: 280000,
        convertedMarketValue: 320000,
        costWeight: 0.795455,
        displayWeight: 0.909091,
        isUnderwater: false,
        isActive: true,
        key: "TW:2313",
        profitWeight: 0.113636,
        unrealizedAmount: 40000,
      },
      {
        activeWeight: 0.090909,
        allWeight: 0.090909,
        convertedCostBasis: 25600,
        convertedMarketValue: 32000,
        costWeight: 0.072727,
        displayWeight: 0.090909,
        isUnderwater: false,
        isActive: true,
        key: "US:ASTS",
        profitWeight: 0.018182,
        unrealizedAmount: 6400,
      },
    ])
  })

  it("ghosts unselected buckets while recalculating active weights within the selected bucket", () => {
    const result = buildPortfolioWeightChartSummary({
      activeBuckets: ["USD"],
      holdings: [
        { bucket: "USD", costBasis: 2000, key: "US:MUU", marketValue: 2200 },
        { bucket: "USD", costBasis: 3600, key: "US:NVDL", marketValue: 3300 },
        {
          bucket: "TWD",
          costBasis: 300000,
          key: "TW:2313",
          marketValue: 352000,
        },
      ],
      usdTwdRate: 32,
    })

    expect(result.baseCurrency).toBe("USD")
    expect(result.bars).toEqual([
      {
        activeWeight: 0.4,
        allWeight: 0.133333,
        convertedCostBasis: 2000,
        convertedMarketValue: 2200,
        costWeight: 0.363636,
        displayWeight: 0.4,
        isUnderwater: false,
        isActive: true,
        key: "US:MUU",
        profitWeight: 0.036364,
        unrealizedAmount: 200,
      },
      {
        activeWeight: 0.6,
        allWeight: 0.2,
        convertedCostBasis: 3600,
        convertedMarketValue: 3300,
        costWeight: 0.6,
        displayWeight: 0.6,
        isUnderwater: true,
        isActive: true,
        key: "US:NVDL",
        profitWeight: 0,
        unrealizedAmount: -300,
      },
      {
        activeWeight: null,
        allWeight: 0.666667,
        convertedCostBasis: 9375,
        convertedMarketValue: 11000,
        costWeight: 0.568182,
        displayWeight: 0.666667,
        isUnderwater: false,
        isActive: false,
        key: "TW:2313",
        profitWeight: 0.098485,
        unrealizedAmount: 1625,
      },
    ])
  })
})
