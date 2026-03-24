import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  computeTradeTotalAmount,
  storedTradeRowSchema,
  type TradeTableRow,
  type UpdateTradeRequest,
} from "@/lib/trades/schema"
import { z } from "zod"

const storedTradeRowsSchema = z.array(storedTradeRowSchema)

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

export async function updateStoredTradeRow(
  update: UpdateTradeRequest,
  filePath = getTradeStoreFilePath()
) {
  return withWriteLock(async () => {
    await ensureTradeStoreFile(filePath)

    const existingRows = await readStoredTradeRows(filePath)
    const index = existingRows.findIndex((row) => row.id === update.id)

    if (index === -1) {
      throw new Error(`Trade with id "${update.id}" not found.`)
    }

    const current = existingRows[index]
    const merged = { ...current, ...update.fields }
    const totalAmount = computeTradeTotalAmount({
      fee: null,
      price: merged.price,
      quantity: merged.quantity,
      side: merged.side,
    })

    const updatedRow: TradeTableRow = {
      ...current,
      ...update.fields,
      totalAmount,
    }

    const nextRows = [...existingRows]
    nextRows[index] = updatedRow

    await writeFile(filePath, `${JSON.stringify(nextRows, null, 2)}\n`, "utf8")

    return nextRows
  })
}

export async function deleteStoredTradeRows(
  ids: string[],
  filePath = getTradeStoreFilePath()
) {
  if (ids.length === 0) {
    return readStoredTradeRows(filePath)
  }

  return withWriteLock(async () => {
    await ensureTradeStoreFile(filePath)

    const existingRows = await readStoredTradeRows(filePath)
    const idsToDelete = new Set(ids)
    const nextRows = existingRows.filter((row) => !idsToDelete.has(row.id))

    await writeFile(filePath, `${JSON.stringify(nextRows, null, 2)}\n`, "utf8")

    return nextRows
  })
}
