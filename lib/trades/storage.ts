import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { tradeTableRowSchema, type TradeTableRow } from "@/lib/trades/schema"
import { z } from "zod"

const storedTradeRowsSchema = z.array(tradeTableRowSchema)

let writeQueue = Promise.resolve()

export function getTradeStoreFilePath(rootDir = process.cwd()) {
  return path.join(rootDir, "data", "transactions.json")
}

async function ensureTradeStoreFile(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true })

  try {
    await readFile(filePath, "utf8")
  } catch {
    await writeFile(filePath, "[]\n", "utf8")
  }
}

function parseStoredRows(rawContent: string) {
  const parsedJson = JSON.parse(rawContent) as unknown
  const parsedRows = storedTradeRowsSchema.safeParse(parsedJson)

  if (!parsedRows.success) {
    throw new Error("The stored transactions file is invalid.")
  }

  return parsedRows.data
}

async function withWriteLock<T>(work: () => Promise<T>) {
  const currentWrite = writeQueue.then(work)
  writeQueue = currentWrite.then(
    () => undefined,
    () => undefined
  )

  return currentWrite
}

export async function readStoredTradeRows(filePath = getTradeStoreFilePath()) {
  await ensureTradeStoreFile(filePath)

  const rawContent = await readFile(filePath, "utf8")
  return parseStoredRows(rawContent)
}

export async function appendStoredTradeRows(
  rows: TradeTableRow[],
  filePath = getTradeStoreFilePath()
) {
  if (rows.length === 0) {
    return readStoredTradeRows(filePath)
  }

  return withWriteLock(async () => {
    await ensureTradeStoreFile(filePath)

    const existingRows = await readStoredTradeRows(filePath)
    const nextRows = [...existingRows, ...rows]

    await writeFile(filePath, `${JSON.stringify(nextRows, null, 2)}\n`, "utf8")

    return nextRows
  })
}
