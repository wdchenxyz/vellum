import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  appendStoredTradeRows,
  getTradeStoreFilePath,
  readStoredTradeRows,
} from "@/lib/trades/storage"

const tempDirectories: string[] = []

function makeRow(id: string, overrides: Partial<{ ticker: string }> = {}) {
  return {
    currency: "USD",
    date: "2026-03-17",
    fee: 1,
    id,
    price: 125,
    quantity: 10,
    side: "BUY" as const,
    sourceFile: "broker-note.pdf",
    ticker: "AAPL",
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
})
