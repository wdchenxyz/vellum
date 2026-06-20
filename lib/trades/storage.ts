import "server-only"

import { DatabaseSync } from "node:sqlite"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import type { Sql, TransactionSql } from "postgres"

import {
  ensurePostgresSchema,
  getLocalSqlitePath,
  getPostgresSql,
  shouldUsePostgresStorage,
} from "@/lib/storage/postgres"
import {
  storedTradeRowSchema,
  type TradeTableRow,
  type UpdateTradeRequest,
} from "@/lib/trades/schema"
import { z } from "zod"

const storedTradeRowsSchema = z.array(storedTradeRowSchema)

export class TradeNotFoundError extends Error {
  constructor(message = "The requested trade was not found.") {
    super(message)
    this.name = "TradeNotFoundError"
  }
}

export class IdempotencyConflictError extends Error {
  constructor(
    message = "The request ID has already been used with different trades."
  ) {
    super(message)
    this.name = "IdempotencyConflictError"
  }
}

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

type QuerySql = Sql | TransactionSql

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

    CREATE TABLE IF NOT EXISTS saved_trade_writes (
      request_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function upsertRows(db: DatabaseSync, rows: TradeTableRow[]) {
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
}

function insertRows(db: DatabaseSync, rows: TradeTableRow[]) {
  if (rows.length === 0) {
    return
  }

  db.exec("BEGIN")

  try {
    upsertRows(db, rows)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

async function upsertRowsPostgres(sql: QuerySql, rows: TradeTableRow[]) {
  for (const row of rows) {
    await sql`
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
        ${row.id},
        ${row.date},
        ${row.ticker},
        ${row.quantity},
        ${row.price},
        ${row.currency},
        ${row.side},
        ${row.account},
        ${row.totalAmount},
        ${row.sourceFile}
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
    `
  }
}

async function insertRowsPostgres(sql: Sql, rows: TradeTableRow[]) {
  if (rows.length === 0) {
    return
  }

  await sql.begin(async (transaction) => {
    await upsertRowsPostgres(transaction, rows)
  })
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

async function readRowsFromPostgres(sql: QuerySql) {
  const rows = (await sql`
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
  `) as StoredTradeRecord[]

  return rows.map((row) => {
    const parsed = storedTradeRowSchema.safeParse(mapStoredRecord(row))

    if (!parsed.success) {
      throw new Error("The stored transactions database is invalid.")
    }

    return parsed.data
  })
}

function readRowsById(db: DatabaseSync, ids: string[]) {
  const requestedIds = new Set(ids)
  const rowsById = new Map(
    readRowsFromDatabase(db)
      .filter((row) => requestedIds.has(row.id))
      .map((row) => [row.id, row])
  )

  return ids.flatMap((id) => {
    const row = rowsById.get(id)
    return row ? [row] : []
  })
}

async function readRowsByIdPostgres(sql: QuerySql, ids: string[]) {
  const requestedIds = new Set(ids)
  const rowsById = new Map(
    (await readRowsFromPostgres(sql))
      .filter((row) => requestedIds.has(row.id))
      .map((row) => [row.id, row])
  )

  return ids.flatMap((id) => {
    const row = rowsById.get(id)
    return row ? [row] : []
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

export async function readStoredTradeRows(databasePath?: string) {
  if (shouldUsePostgresStorage(databasePath)) {
    const sql = getPostgresSql()
    await ensurePostgresSchema(sql)

    return readRowsFromPostgres(sql)
  }

  const sqlitePath = getLocalSqlitePath(
    databasePath,
    getTradeStoreDatabasePath()
  )
  const db = await openTradeDatabase(sqlitePath)

  try {
    return readRowsFromDatabase(db)
  } finally {
    db.close()
  }
}

export async function appendStoredTradeRows(
  rows: TradeTableRow[],
  databasePath?: string
) {
  if (rows.length === 0) {
    return readStoredTradeRows(databasePath)
  }

  if (shouldUsePostgresStorage(databasePath)) {
    const sql = getPostgresSql()
    await ensurePostgresSchema(sql)
    await insertRowsPostgres(sql, rows)

    return readRowsFromPostgres(sql)
  }

  return withWriteLock(async () => {
    const sqlitePath = getLocalSqlitePath(
      databasePath,
      getTradeStoreDatabasePath()
    )
    const db = await openTradeDatabase(sqlitePath)

    try {
      insertRows(db, rows)

      return readRowsFromDatabase(db)
    } finally {
      db.close()
    }
  })
}

export async function appendStoredTradeRowsIdempotently(
  {
    payloadHash,
    requestId,
    rows,
  }: {
    payloadHash: string
    requestId: string
    rows: TradeTableRow[]
  },
  databasePath?: string
) {
  if (shouldUsePostgresStorage(databasePath)) {
    const sql = getPostgresSql()
    const rowIds = rows.map((row) => row.id)
    await ensurePostgresSchema(sql)

    return sql.begin(async (transaction) => {
      const existing = (await transaction`
        SELECT payload_hash
        FROM saved_trade_writes
        WHERE request_id = ${requestId}
      `) as { payload_hash: string }[]

      if (existing[0]) {
        if (existing[0].payload_hash !== payloadHash) {
          throw new IdempotencyConflictError()
        }

        return {
          replayed: true,
          rows: await readRowsByIdPostgres(transaction, rowIds),
        }
      }

      await upsertRowsPostgres(transaction, rows)
      await transaction`
        INSERT INTO saved_trade_writes (request_id, payload_hash)
        VALUES (${requestId}, ${payloadHash})
      `

      return {
        replayed: false,
        rows: await readRowsByIdPostgres(transaction, rowIds),
      }
    })
  }

  return withWriteLock(async () => {
    const sqlitePath = getLocalSqlitePath(
      databasePath,
      getTradeStoreDatabasePath()
    )
    const db = await openTradeDatabase(sqlitePath)
    const rowIds = rows.map((row) => row.id)

    try {
      db.exec("BEGIN IMMEDIATE")

      try {
        const existing = db
          .prepare(
            "SELECT payload_hash FROM saved_trade_writes WHERE request_id = ?"
          )
          .get(requestId) as { payload_hash: string } | undefined

        if (existing) {
          if (existing.payload_hash !== payloadHash) {
            throw new IdempotencyConflictError()
          }

          const savedRows = readRowsById(db, rowIds)
          db.exec("COMMIT")

          return {
            replayed: true,
            rows: savedRows,
          }
        }

        upsertRows(db, rows)
        db.prepare(
          "INSERT INTO saved_trade_writes (request_id, payload_hash) VALUES (?, ?)"
        ).run(requestId, payloadHash)
        const savedRows = readRowsById(db, rowIds)
        db.exec("COMMIT")

        return {
          replayed: false,
          rows: savedRows,
        }
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    } finally {
      db.close()
    }
  })
}

export async function deleteStoredTradeRows(
  ids: string[],
  databasePath?: string
) {
  if (ids.length === 0) {
    return readStoredTradeRows(databasePath)
  }

  if (shouldUsePostgresStorage(databasePath)) {
    const sql = getPostgresSql()
    await ensurePostgresSchema(sql)

    await sql.begin(async (transaction) => {
      await transaction`
        DELETE FROM transactions
        WHERE id IN ${transaction(ids)}
      `
    })

    return readRowsFromPostgres(sql)
  }

  return withWriteLock(async () => {
    const sqlitePath = getLocalSqlitePath(
      databasePath,
      getTradeStoreDatabasePath()
    )
    const db = await openTradeDatabase(sqlitePath)

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

export async function updateStoredTradeRow(
  id: string,
  row: UpdateTradeRequest["row"],
  databasePath?: string
) {
  if (shouldUsePostgresStorage(databasePath)) {
    const sql = getPostgresSql()
    await ensurePostgresSchema(sql)

    return sql.begin(async (transaction) => {
      const existing = (await transaction`
        SELECT id
        FROM transactions
        WHERE id = ${id}
      `) as { id: string }[]

      if (!existing[0]) {
        throw new TradeNotFoundError()
      }

      await transaction`
        UPDATE transactions
        SET
          trade_date = ${row.date},
          ticker = ${row.ticker},
          quantity = ${row.quantity},
          price = ${row.price},
          currency = ${row.currency},
          side = ${row.side},
          account = ${row.account},
          total_amount = ${row.totalAmount},
          source_file = ${row.sourceFile}
        WHERE id = ${id}
      `

      return readRowsFromPostgres(transaction)
    })
  }

  return withWriteLock(async () => {
    const sqlitePath = getLocalSqlitePath(
      databasePath,
      getTradeStoreDatabasePath()
    )
    const db = await openTradeDatabase(sqlitePath)

    try {
      const existing = db
        .prepare("SELECT id FROM transactions WHERE id = ?")
        .get(id) as { id: string } | undefined

      if (!existing) {
        throw new TradeNotFoundError()
      }

      const statement = db.prepare(`
        UPDATE transactions
        SET
          trade_date = ?,
          ticker = ?,
          quantity = ?,
          price = ?,
          currency = ?,
          side = ?,
          account = ?,
          total_amount = ?,
          source_file = ?
        WHERE id = ?
      `)

      db.exec("BEGIN")

      try {
        statement.run(
          row.date,
          row.ticker,
          row.quantity,
          row.price,
          row.currency,
          row.side,
          row.account,
          row.totalAmount,
          row.sourceFile,
          id
        )

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
