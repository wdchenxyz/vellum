import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  appendStoredTradeRows,
  getTradeStoreFilePath,
  readStoredTradeRows,
} from "@/lib/trades/storage"

const tempDirectories: string[] = []

function makeRow(
  id: string,
  overrides: Partial<{ account: string | null; ticker: string }> = {}
) {
  return {
    account: null,
    currency: "USD",
    date: "2026-03-17",
    id,
    price: 125,
    quantity: 10,
    side: "BUY" as const,
    sourceFile: "broker-note.pdf",
    ticker: "AAPL",
    totalAmount: 1251,
    ...overrides,
  }
}

async function createTempStorePath() {
  const directory = await mkdtemp(path.join(tmpdir(), "vellum-trades-"))
  tempDirectories.push(directory)
  return getTradeStoreFilePath(directory)
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("trade storage", () => {
  it("creates an empty JSON text file on first read", async () => {
    const filePath = await createTempStorePath()

    const rows = await readStoredTradeRows(filePath)
    const rawContent = await readFile(filePath, "utf8")

    expect(rows).toEqual([])
    expect(rawContent.trim()).toBe("[]")
  })

  it("appends transactions and keeps them available across reads", async () => {
    const filePath = await createTempStorePath()

    await appendStoredTradeRows([makeRow("row_1")], filePath)
    await appendStoredTradeRows(
      [makeRow("row_2", { ticker: "MSFT" })],
      filePath
    )

    const rows = await readStoredTradeRows(filePath)

    expect(rows).toEqual([
      makeRow("row_1"),
      makeRow("row_2", { ticker: "MSFT" }),
    ])
  })

  it("normalizes legacy rows without account or totalAmount", async () => {
    const filePath = await createTempStorePath()

    await readStoredTradeRows(filePath)

    await writeFile(
      filePath,
      `${JSON.stringify([
        {
          currency: "USD",
          date: "2026-03-17",
          fee: 1,
          id: "legacy-row",
          price: 125,
          quantity: 10,
          side: "BUY",
          sourceFile: "broker-note.pdf",
          ticker: "AAPL",
        },
      ])}\n`,
      "utf8"
    )

    const rows = await readStoredTradeRows(filePath)

    expect(rows).toEqual([
      {
        account: null,
        currency: "USD",
        date: "2026-03-17",
        id: "legacy-row",
        price: 125,
        quantity: 10,
        side: "BUY",
        sourceFile: "broker-note.pdf",
        ticker: "AAPL",
        totalAmount: 1251,
      },
    ])
  })
})
