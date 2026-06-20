import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  saveReviewedTrades: vi.fn(),
}))

vi.mock("@/lib/trades/save", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trades/save")>()

  return {
    ...actual,
    saveReviewedTrades: mocks.saveReviewedTrades,
  }
})

const { POST } = await import("@/app/api/trades/rows/route")
const { InvalidSavedTradeRequestError } = await import("@/lib/trades/save")
const { IdempotencyConflictError } = await import("@/lib/trades/storage")

function createPostRequest(payload: unknown) {
  return new Request("http://localhost/api/trades/rows", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("POST /api/trades/rows", () => {
  it("creates a reviewed trade batch", async () => {
    const rows = [{ id: "api-row-1" }]
    mocks.saveReviewedTrades.mockResolvedValue({ replayed: false, rows })

    const response = await POST(
      createPostRequest({ requestId: "batch-1", trades: [{}] })
    )

    expect(response.status).toBe(201)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(mocks.saveReviewedTrades).toHaveBeenCalledWith({
      requestId: "batch-1",
      trades: [{}],
    })
    await expect(response.json()).resolves.toEqual({
      replayed: false,
      rows,
    })
  })

  it("returns success without creating duplicates for an idempotent replay", async () => {
    mocks.saveReviewedTrades.mockResolvedValue({ replayed: true, rows: [] })

    const response = await POST(
      createPostRequest({ requestId: "batch-1", trades: [{}] })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      replayed: true,
      rows: [],
    })
  })

  it("rejects invalid JSON and invalid trade payloads", async () => {
    const invalidJsonResponse = await POST(
      new Request("http://localhost/api/trades/rows", {
        body: "{",
        method: "POST",
      })
    )
    mocks.saveReviewedTrades.mockRejectedValue(
      new InvalidSavedTradeRequestError()
    )
    const invalidTradeResponse = await POST(
      createPostRequest({ requestId: "batch-1", trades: [] })
    )

    expect(invalidJsonResponse.status).toBe(400)
    expect(invalidTradeResponse.status).toBe(400)
  })

  it("rejects reuse of a request ID with different trades", async () => {
    mocks.saveReviewedTrades.mockRejectedValue(new IdempotencyConflictError())

    const response = await POST(
      createPostRequest({ requestId: "batch-1", trades: [{}] })
    )

    expect(response.status).toBe(409)
  })
})
