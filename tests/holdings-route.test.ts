import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCurrentHoldings: vi.fn(),
}))

vi.mock("@/lib/portfolio/current-holdings", () => ({
  getCurrentHoldings: mocks.getCurrentHoldings,
}))

const { GET } = await import("@/app/api/portfolio/holdings/route")

beforeEach(() => {
  vi.resetAllMocks()
})

describe("GET /api/portfolio/holdings", () => {
  it("returns current holdings and forwards optional filters", async () => {
    const result = {
      groups: [{ account: "Firstrade", holdings: [{ ticker: "AMD" }] }],
      issues: [],
      totalHoldings: 1,
    }
    mocks.getCurrentHoldings.mockResolvedValue(result)

    const response = await GET(
      new Request(
        "http://localhost/api/portfolio/holdings?account=Firstrade&ticker=AMD&forceRefresh=true"
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(mocks.getCurrentHoldings).toHaveBeenCalledWith({
      account: "Firstrade",
      forceRefresh: true,
      ticker: "AMD",
    })
    await expect(response.json()).resolves.toEqual(result)
  })

  it("rejects an invalid forceRefresh value", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/portfolio/holdings?forceRefresh=sometimes"
      )
    )

    expect(response.status).toBe(400)
    expect(mocks.getCurrentHoldings).not.toHaveBeenCalled()
  })

  it("returns a server error when holdings cannot be loaded", async () => {
    mocks.getCurrentHoldings.mockRejectedValue(new Error("Quote failure."))

    const response = await GET(
      new Request("http://localhost/api/portfolio/holdings")
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Quote failure." })
  })
})
