import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  InvalidSavedTradeRequestError,
  saveReviewedTrades,
} from "@/lib/trades/save"
import {
  getTradeStoreDatabasePath,
  IdempotencyConflictError,
  readStoredTradeRows,
} from "@/lib/trades/storage"

const tempDirectories: string[] = []

async function createTempStorePath() {
  const directory = await mkdtemp(path.join(tmpdir(), "vellum-trades-"))
  tempDirectories.push(directory)
  return getTradeStoreDatabasePath(directory)
}

function makeRequest(price = 10) {
  return {
    requestId: "confirmed-trades-2026-06-20",
    trades: [
      {
        account: " Firstrade ",
        currency: "usd",
        date: "2026-06-16",
        fee: 1,
        price,
        quantity: 2,
        side: "BUY",
        sourceFile: " IMG_3297.png ",
        ticker: "amd",
      },
      {
        account: "Firstrade",
        currency: "USD",
        date: "2026-06-16",
        price: 20,
        quantity: 1,
        settlementAmount: 19.5,
        side: "SELL",
        sourceFile: "IMG_3297.png",
        ticker: "MU",
      },
    ],
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("saveReviewedTrades", () => {
  it("validates, normalizes, calculates, and atomically saves reviewed trades", async () => {
    const databasePath = await createTempStorePath()

    const result = await saveReviewedTrades(makeRequest(), databasePath)

    expect(result).toEqual({
      replayed: false,
      rows: [
        {
          account: "Firstrade",
          currency: "USD",
          date: "2026-06-16",
          id: expect.stringMatching(/^api-[a-f0-9]{64}$/),
          price: 10,
          quantity: 2,
          side: "BUY",
          sourceFile: "IMG_3297.png",
          ticker: "AMD",
          totalAmount: 21,
        },
        {
          account: "Firstrade",
          currency: "USD",
          date: "2026-06-16",
          id: expect.stringMatching(/^api-[a-f0-9]{64}$/),
          price: 20,
          quantity: 1,
          side: "SELL",
          sourceFile: "IMG_3297.png",
          ticker: "MU",
          totalAmount: 19.5,
        },
      ],
    })
    await expect(readStoredTradeRows(databasePath)).resolves.toEqual(
      result.rows
    )
  })

  it("returns the original saved trades when the same request is retried", async () => {
    const databasePath = await createTempStorePath()
    const request = makeRequest()
    const first = await saveReviewedTrades(request, databasePath)
    const normalizedRetry = makeRequest()
    normalizedRetry.trades[0].account = "Firstrade"
    normalizedRetry.trades[0].currency = "USD"
    normalizedRetry.trades[0].sourceFile = "IMG_3297.png"
    normalizedRetry.trades[0].ticker = "AMD"

    const replay = await saveReviewedTrades(normalizedRetry, databasePath)

    expect(replay).toEqual({ replayed: true, rows: first.rows })
    await expect(readStoredTradeRows(databasePath)).resolves.toHaveLength(2)
  })

  it("rejects a reused request ID when the trade payload changes", async () => {
    const databasePath = await createTempStorePath()

    await saveReviewedTrades(makeRequest(), databasePath)

    await expect(
      saveReviewedTrades(makeRequest(11), databasePath)
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
    await expect(readStoredTradeRows(databasePath)).resolves.toHaveLength(2)
  })

  it("rejects invalid trades before opening the database", async () => {
    const databasePath = await createTempStorePath()

    await expect(
      saveReviewedTrades(
        {
          requestId: "invalid-batch",
          trades: [{ ticker: "" }],
        },
        databasePath
      )
    ).rejects.toBeInstanceOf(InvalidSavedTradeRequestError)
  })
})
