import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ExtractedTrade, TradeFileInput } from "@/lib/trades/schema"

const mocks = vi.hoisted(() => ({
  appendStoredTradeRows: vi.fn(),
  appendStoredTradeRowsIdempotently: vi.fn(),
  extractTradesFromFile: vi.fn(),
  resolveExtractedTradeTicker: vi.fn(),
}))

vi.mock("@/lib/trades/extract", () => ({
  extractTradesFromFile: mocks.extractTradesFromFile,
}))

vi.mock("@/lib/trades/resolve-ticker", () => ({
  resolveExtractedTradeTicker: mocks.resolveExtractedTradeTicker,
}))

vi.mock("@/lib/trades/storage", () => ({
  appendStoredTradeRows: mocks.appendStoredTradeRows,
  appendStoredTradeRowsIdempotently: mocks.appendStoredTradeRowsIdempotently,
  getTradeStoreDatabasePath: vi.fn(),
}))

import { captureTradeConfirmations } from "@/lib/trades/capture"

function makeDataUrl(bytes = "trade confirmation") {
  return `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`
}

function makeFile(overrides: Partial<TradeFileInput> = {}): TradeFileInput {
  return {
    filename: "broker-confirmation.pdf",
    mediaType: "application/pdf",
    type: "file",
    url: makeDataUrl(),
    ...overrides,
  }
}

function makeExtractedTrade(
  overrides: Partial<ExtractedTrade> = {}
): ExtractedTrade {
  return {
    currency: "USD",
    date: "2026-03-17",
    fee: 1,
    price: 10,
    quantity: 2,
    securityName: "GraniteShares 2x Long NVDA Daily ETF",
    settlementAmount: null,
    side: "BUY",
    ticker: "GRANITESHARES 2X LONG NVDA DAI",
    tickerCandidates: [
      {
        confidence: 0.9,
        reason: "Candidate appears in the visible fund name.",
        ticker: "NVDL",
      },
    ],
    ...overrides,
  }
}

describe("captureTradeConfirmations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.appendStoredTradeRows.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("rejects invalid request bodies before extraction", async () => {
    const result = await captureTradeConfirmations({ files: [] })

    expect(result).toEqual({
      error: "Please send at least one image or PDF file.",
      kind: "invalid-request",
      status: "rejected",
    })
    expect(mocks.extractTradesFromFile).not.toHaveBeenCalled()
    expect(mocks.appendStoredTradeRows).not.toHaveBeenCalled()
  })

  it("rejects unsupported trade confirmation uploads before extraction", async () => {
    const result = await captureTradeConfirmations({
      files: [
        makeFile({
          mediaType: "text/plain",
          url: `data:text/plain;base64,${Buffer.from("note").toString("base64")}`,
        }),
      ],
    })

    expect(result).toEqual({
      error: "Only images and PDF files are supported in this MVP.",
      kind: "invalid-upload",
      status: "rejected",
    })
    expect(mocks.extractTradesFromFile).not.toHaveBeenCalled()
    expect(mocks.appendStoredTradeRows).not.toHaveBeenCalled()
  })

  it("extracts, resolves, shapes, and persists saved trades", async () => {
    const file = makeFile()
    const extractedTrade = makeExtractedTrade()
    const resolvedTrade = {
      ...extractedTrade,
      ticker: "NVDL",
    }

    mocks.extractTradesFromFile.mockResolvedValue({
      fileName: "broker-confirmation.pdf",
      trades: [extractedTrade],
    })
    mocks.resolveExtractedTradeTicker.mockResolvedValue({
      status: "accepted",
      trade: resolvedTrade,
    })

    const result = await captureTradeConfirmations({
      account: "Firstrade",
      files: [file],
      prompt: "Use filled transactions only.",
    })
    const [savedRows] = mocks.appendStoredTradeRows.mock.calls[0]

    expect(mocks.extractTradesFromFile).toHaveBeenCalledWith({
      file,
      prompt: "Use filled transactions only.",
    })
    expect(mocks.resolveExtractedTradeTicker).toHaveBeenCalledWith({
      trade: extractedTrade,
    })
    expect(savedRows).toEqual([
      {
        account: "Firstrade",
        currency: "USD",
        date: "2026-03-17",
        id: expect.any(String),
        price: 10,
        quantity: 2,
        side: "BUY",
        sourceFile: "broker-confirmation.pdf",
        ticker: "NVDL",
        totalAmount: 21,
      },
    ])
    expect(result).toEqual({
      response: {
        results: [
          {
            fileName: "broker-confirmation.pdf",
            trades: [resolvedTrade],
          },
        ],
        rows: savedRows,
      },
      status: "captured",
    })
  })

  it("keeps unresolved proposed trades out of saved rows while returning file issues", async () => {
    const extractedTrade = makeExtractedTrade()

    mocks.extractTradesFromFile.mockResolvedValue({
      error: "The model returned incomplete output.",
      fileName: "broker-confirmation.pdf",
      trades: [extractedTrade],
    })
    mocks.resolveExtractedTradeTicker.mockResolvedValue({
      issue: "GRANITESHARES 2X LONG NVDA DAI: no visible ticker was found.",
      status: "unresolved",
      trade: extractedTrade,
    })

    const result = await captureTradeConfirmations({
      files: [makeFile()],
    })

    expect(mocks.appendStoredTradeRows).toHaveBeenCalledWith([])
    expect(result).toEqual({
      response: {
        results: [
          {
            error:
              "The model returned incomplete output. GRANITESHARES 2X LONG NVDA DAI: no visible ticker was found.",
            fileName: "broker-confirmation.pdf",
            trades: [],
          },
        ],
        rows: [],
      },
      status: "captured",
    })
  })

  it("returns a rejected lifecycle result when saved trade persistence fails", async () => {
    const extractedTrade = makeExtractedTrade({ ticker: "AAPL" })

    mocks.extractTradesFromFile.mockResolvedValue({
      fileName: "broker-confirmation.pdf",
      trades: [extractedTrade],
    })
    mocks.resolveExtractedTradeTicker.mockResolvedValue({
      status: "accepted",
      trade: extractedTrade,
    })
    mocks.appendStoredTradeRows.mockRejectedValue(
      new Error("SQLite is unavailable.")
    )

    const result = await captureTradeConfirmations({
      files: [makeFile()],
    })

    expect(result).toEqual({
      error: "SQLite is unavailable.",
      kind: "persistence-failed",
      status: "rejected",
    })
  })
})
