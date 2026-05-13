import "server-only"

import { DatabaseSync } from "node:sqlite"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"

import { storedTradeRowSchema, type TradeTableRow } from "@/lib/trades/schema"
import { z } from "zod"

const storedTradeRowsSchema = z.array(storedTradeRowSchema)

let writeQueue = Promise.resolve()

type StoredTradeRecord = {
  account: string | null
  currency: string | null
  date: string
  id: string
  price: number
  quantity: number
  side: TradeTableRow["side"]
  source_file: string
  ticker: string
  total_amount: number
}

export function getTradeStoreDatabasePath(rootDir = process.cwd()) {
  return path.join(rootDir, "data", "transactions.sqlite")
}

export function getLegacyTradeStoreFilePath(rootDir = process.cwd()) {
  return path.join(rootDir, "data", "transactions.json")
}

export const getTradeStoreFilePath = getTradeStoreDatabasePath

function getLegacyTradeStoreFilePathForDatabase(databasePath: string) {
  return path.join(path.dirname(databasePath), "transactions.json")
}

function parseStoredRows(rawContent: string) {
  const parsedJson = JSON.parse(rawContent) as unknown
  const parsedRows = storedTradeRowsSchema.safeParse(parsedJson)

  if (!parsedRows.success) {
    throw new Error("The stored transactions file is invalid.")
  }

  return parsedRows.data
}

function createTradeSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS transactions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      trade_date TEXT NOT NULL,
      ticker TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      currency TEXT,
      side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
      account TEXT,
      total_amount REAL NOT NULL,
      source_file TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS transactions_trade_date_idx
      ON transactions (trade_date);

    CREATE INDEX IF NOT EXISTS transactions_account_idx
      ON transactions (account);

    CREATE INDEX IF NOT EXISTS transactions_ticker_idx
      ON transactions (ticker);
  `)
}

function insertRows(db: DatabaseSync, rows: TradeTableRow[]) {
  if (rows.length === 0) {
    return
  }

  const statement = db.prepare(`
    INSERT INTO transactions (
      id,
      trade_date,
      ticker,
      quantity,
      price,
      currency,
      side,
      account,
      total_amount,
      source_file
    ) VALUES (
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?
    )
    ON CONFLICT(id) DO UPDATE SET
      trade_date = excluded.trade_date,
      ticker = excluded.ticker,
      quantity = excluded.quantity,
      price = excluded.price,
      currency = excluded.currency,
      side = excluded.side,
      account = excluded.account,
      total_amount = excluded.total_amount,
      source_file = excluded.source_file
  `)

  db.exec("BEGIN")

  try {
    for (const row of rows) {
      statement.run(
        row.id,
        row.date,
        row.ticker,
        row.quantity,
        row.price,
        row.currency,
        row.side,
        row.account,
        row.totalAmount,
        row.sourceFile
      )
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

function mapStoredRecord(record: StoredTradeRecord): TradeTableRow {
  return {
    account: record.account,
    currency: record.currency,
    date: record.date,
    id: record.id,
    price: record.price,
    quantity: record.quantity,
    side: record.side,
    sourceFile: record.source_file,
    ticker: record.ticker,
    totalAmount: record.total_amount,
  }
}

function readRowsFromDatabase(db: DatabaseSync) {
  const rows = db
    .prepare(
      `
      SELECT
        account,
        currency,
        trade_date AS date,
        id,
        price,
        quantity,
        side,
        source_file,
        ticker,
        total_amount
      FROM transactions
      ORDER BY sequence ASC
    `
    )
    .all() as StoredTradeRecord[]

  return rows.map((row) => {
    const parsed = storedTradeRowSchema.safeParse(mapStoredRecord(row))

    if (!parsed.success) {
      throw new Error("The stored transactions database is invalid.")
    }

    return parsed.data
  })
}

function hasStoredRows(db: DatabaseSync) {
  const result = db
    .prepare("SELECT COUNT(*) AS count FROM transactions")
    .get() as { count: number }

  return result.count > 0
}

async function migrateLegacyJsonRows(db: DatabaseSync, databasePath: string) {
  if (hasStoredRows(db)) {
    return
  }

  const legacyPath = getLegacyTradeStoreFilePathForDatabase(databasePath)
  let rawContent: string

  try {
    rawContent = await readFile(legacyPath, "utf8")
  } catch {
    return
  }

  const rows = parseStoredRows(rawContent)
  insertRows(db, rows)
}

async function openTradeDatabase(databasePath: string) {
  await mkdir(path.dirname(databasePath), { recursive: true })

  const db = new DatabaseSync(databasePath)
  createTradeSchema(db)
  await migrateLegacyJsonRows(db, databasePath)

  return db
}

async function withWriteLock<T>(work: () => Promise<T>) {
  const currentWrite = writeQueue.then(work)
  writeQueue = currentWrite.then(
    () => undefined,
    () => undefined
  )

  return currentWrite
}

export async function readStoredTradeRows(
  databasePath = getTradeStoreDatabasePath()
) {
  const db = await openTradeDatabase(databasePath)

  try {
    return readRowsFromDatabase(db)
  } finally {
    db.close()
  }
}

export async function appendStoredTradeRows(
  rows: TradeTableRow[],
  databasePath = getTradeStoreDatabasePath()
) {
  if (rows.length === 0) {
    return readStoredTradeRows(databasePath)
  }

  return withWriteLock(async () => {
    const db = await openTradeDatabase(databasePath)

    try {
      insertRows(db, rows)

      return readRowsFromDatabase(db)
    } finally {
      db.close()
    }
  })
}

export async function deleteStoredTradeRows(
  ids: string[],
  databasePath = getTradeStoreDatabasePath()
) {
  if (ids.length === 0) {
    return readStoredTradeRows(databasePath)
  }

  return withWriteLock(async () => {
    const db = await openTradeDatabase(databasePath)

    try {
      const statement = db.prepare("DELETE FROM transactions WHERE id = ?")

      db.exec("BEGIN")

      try {
        for (const id of ids) {
          statement.run(id)
        }

        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }

      return readRowsFromDatabase(db)
    } finally {
      db.close()
    }
  })
}
