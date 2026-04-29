import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  appendStoredTradeRows,
  deleteStoredTradeRows,
  getLegacyTradeStoreFilePath,
  getTradeStoreDatabasePath,
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
  return getTradeStoreDatabasePath(directory)
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("trade storage", () => {
  it("creates an empty SQLite database on first read", async () => {
    const databasePath = await createTempStorePath()

    const rows = await readStoredTradeRows(databasePath)
    const rawContent = await readFile(databasePath)

    expect(rows).toEqual([])
    expect(rawContent.subarray(0, 16).toString()).toBe("SQLite format 3\0")
  })

  it("appends transactions and keeps them available across reads", async () => {
    const databasePath = await createTempStorePath()

    await appendStoredTradeRows([makeRow("row_1")], databasePath)
    await appendStoredTradeRows(
      [makeRow("row_2", { ticker: "MSFT" })],
      databasePath
    )

    const rows = await readStoredTradeRows(databasePath)

    expect(rows).toEqual([
      makeRow("row_1"),
      makeRow("row_2", { ticker: "MSFT" }),
    ])
  })

  it("deletes a single row by id", async () => {
    const databasePath = await createTempStorePath()

    await appendStoredTradeRows(
      [makeRow("row_1"), makeRow("row_2", { ticker: "MSFT" })],
      databasePath
    )

    const remaining = await deleteStoredTradeRows(["row_1"], databasePath)

    expect(remaining).toEqual([makeRow("row_2", { ticker: "MSFT" })])
    expect(await readStoredTradeRows(databasePath)).toEqual(remaining)
  })

  it("deletes multiple rows at once", async () => {
    const databasePath = await createTempStorePath()

    await appendStoredTradeRows(
      [
        makeRow("row_1"),
        makeRow("row_2", { ticker: "MSFT" }),
        makeRow("row_3", { ticker: "GOOG" }),
      ],
      databasePath
    )

    const remaining = await deleteStoredTradeRows(
      ["row_1", "row_3"],
      databasePath
    )

    expect(remaining).toEqual([makeRow("row_2", { ticker: "MSFT" })])
  })

  it("returns all rows unchanged when deleting a non-existent id", async () => {
    const databasePath = await createTempStorePath()

    await appendStoredTradeRows([makeRow("row_1")], databasePath)

    const remaining = await deleteStoredTradeRows(["no-such-id"], databasePath)

    expect(remaining).toEqual([makeRow("row_1")])
  })

  it("handles deleting from an empty store", async () => {
    const databasePath = await createTempStorePath()

    const remaining = await deleteStoredTradeRows(["row_1"], databasePath)

    expect(remaining).toEqual([])
  })

  it("migrates and normalizes legacy JSON rows without account or totalAmount", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "vellum-trades-"))
    tempDirectories.push(directory)
    const databasePath = getTradeStoreDatabasePath(directory)
    const legacyPath = getLegacyTradeStoreFilePath(directory)

    await mkdir(path.dirname(legacyPath), { recursive: true })
    await writeFile(
      legacyPath,
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

    const rows = await readStoredTradeRows(databasePath)

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
