import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  computeDailyValuesFromTrades: vi.fn(),
  readStoredTradeRows: vi.fn(),
}))

vi.mock("@/lib/portfolio/daily-values-service", () => ({
  computeDailyValuesFromTrades: mocks.computeDailyValuesFromTrades,
}))

vi.mock("@/lib/trades/storage", () => ({
  readStoredTradeRows: mocks.readStoredTradeRows,
}))

import { getDailyValues } from "@/lib/tools/get-daily-values"

describe("getDailyValues", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readStoredTradeRows.mockResolvedValue([{ id: "trade-1" }])
    mocks.computeDailyValuesFromTrades.mockResolvedValue({
      benchmarks: {
        spx: [
          { date: "2026-03-01", value: 100 },
          { date: "2026-03-02", value: 130 },
          { date: "2026-03-03", value: 104 },
        ],
        twii: [
          { date: "2026-03-01", value: 80 },
          { date: "2026-03-02", value: 88 },
          { date: "2026-03-03", value: 96 },
        ],
      },
      costBasisTwd: 12345,
      issues: ["preserved issue"],
      series: [
        { date: "2026-03-01", value: 100 },
        { date: "2026-03-02", value: 120 },
        { date: "2026-03-03", value: 90 },
        { date: "2026-03-04", value: 110 },
      ],
    })
  })

  it("filters the returned series and computes summary metrics from the filtered range", async () => {
    const result = await getDailyValues.execute?.({
      dateFrom: "2026-03-02",
      dateTo: "2026-03-03",
    })

    expect(mocks.readStoredTradeRows).toHaveBeenCalledTimes(1)
    expect(mocks.computeDailyValuesFromTrades).toHaveBeenCalledWith([
      { id: "trade-1" },
    ])
    expect(result).toEqual({
      benchmarks: {
        spx: {
          endValue: 104,
          returnPct: -20,
          series: [
            { date: "2026-03-02", value: 130 },
            { date: "2026-03-03", value: 104 },
          ],
          startValue: 130,
        },
        twii: {
          endValue: 96,
          returnPct: 9.09,
          series: [
            { date: "2026-03-02", value: 88 },
            { date: "2026-03-03", value: 96 },
          ],
          startValue: 88,
        },
      },
      costBasisTwd: 12345,
      dateRange: {
        dataPoints: 2,
        from: "2026-03-02",
        to: "2026-03-03",
      },
      issues: ["preserved issue"],
      portfolio: {
        endValue: 90,
        maxDrawdownPct: 25,
        returnPct: -25,
        series: [
          { date: "2026-03-02", value: 120 },
          { date: "2026-03-03", value: 90 },
        ],
        startValue: 120,
      },
    })
  })

  it("returns null summaries when the filtered range has no portfolio points", async () => {
    const result = await getDailyValues.execute?.({
      dateFrom: "2026-04-01",
      dateTo: "2026-04-02",
    })

    expect(result).toEqual({
      benchmarks: {
        spx: {
          endValue: null,
          returnPct: null,
          series: [],
          startValue: null,
        },
        twii: {
          endValue: null,
          returnPct: null,
          series: [],
          startValue: null,
        },
      },
      costBasisTwd: 12345,
      dateRange: {
        dataPoints: 0,
        from: null,
        to: null,
      },
      issues: ["preserved issue"],
      portfolio: {
        endValue: null,
        maxDrawdownPct: null,
        returnPct: null,
        series: [],
        startValue: null,
      },
    })
  })
})
