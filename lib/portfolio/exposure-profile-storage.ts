import "server-only"

import { DatabaseSync } from "node:sqlite"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import {
  DEFAULT_EXPOSURE_PROFILES,
  instrumentExposureProfileSchema,
  normalizeExposureProfile,
  type InstrumentExposureProfile,
  type UpsertInstrumentExposureProfile,
} from "@/lib/portfolio/exposure-profiles"
import { getTradeStoreDatabasePath } from "@/lib/trades/storage"

type StoredExposureProfileRecord = {
  created_at: string
  exposure_direction: InstrumentExposureProfile["exposureDirection"]
  exposure_multiplier: number
  instrument_name: string | null
  market: InstrumentExposureProfile["market"]
  notes: string | null
  source: string | null
  ticker: string
  underlying_market: InstrumentExposureProfile["underlyingMarket"]
  underlying_ticker: string
  updated_at: string
}

let exposureWriteQueue = Promise.resolve()

function createExposureProfileSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS instrument_exposure_profiles (
      market TEXT NOT NULL,
      ticker TEXT NOT NULL,
      instrument_name TEXT,
      underlying_market TEXT NOT NULL,
      underlying_ticker TEXT NOT NULL,
      exposure_multiplier REAL NOT NULL CHECK (exposure_multiplier > 0),
      exposure_direction TEXT NOT NULL CHECK (exposure_direction IN ('long', 'inverse')),
      source TEXT,
      review_status TEXT NOT NULL DEFAULT 'reviewed',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (market, ticker)
    );

    CREATE INDEX IF NOT EXISTS instrument_exposure_profiles_underlying_idx
      ON instrument_exposure_profiles (underlying_market, underlying_ticker);
  `)
}

function mapStoredExposureProfile(
  record: StoredExposureProfileRecord
): InstrumentExposureProfile {
  const parsed = instrumentExposureProfileSchema.safeParse({
    createdAt: record.created_at,
    exposureDirection: record.exposure_direction,
    exposureMultiplier: record.exposure_multiplier,
    instrumentName: record.instrument_name,
    market: record.market,
    notes: record.notes,
    source: record.source,
    ticker: record.ticker,
    underlyingMarket: record.underlying_market,
    underlyingTicker: record.underlying_ticker,
    updatedAt: record.updated_at,
  })

  if (!parsed.success) {
    throw new Error("The stored exposure profile database is invalid.")
  }

  return parsed.data
}

function upsertProfile(
  db: DatabaseSync,
  profile: UpsertInstrumentExposureProfile
) {
  const normalized = normalizeExposureProfile(profile)
  const statement = db.prepare(`
    INSERT INTO instrument_exposure_profiles (
      market,
      ticker,
      instrument_name,
      underlying_market,
      underlying_ticker,
      exposure_multiplier,
      exposure_direction,
      source,
      review_status,
      notes
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
    ON CONFLICT(market, ticker) DO UPDATE SET
      instrument_name = excluded.instrument_name,
      underlying_market = excluded.underlying_market,
      underlying_ticker = excluded.underlying_ticker,
      exposure_multiplier = excluded.exposure_multiplier,
      exposure_direction = excluded.exposure_direction,
      source = excluded.source,
      review_status = excluded.review_status,
      notes = excluded.notes,
      updated_at = datetime('now')
  `)

  statement.run(
    normalized.market,
    normalized.ticker,
    normalized.instrumentName,
    normalized.underlyingMarket,
    normalized.underlyingTicker,
    normalized.exposureMultiplier,
    normalized.exposureDirection,
    normalized.source,
    "reviewed",
    normalized.notes
  )
}

function seedDefaultProfiles(db: DatabaseSync) {
  const statement = db.prepare(`
    INSERT INTO instrument_exposure_profiles (
      market,
      ticker,
      instrument_name,
      underlying_market,
      underlying_ticker,
      exposure_multiplier,
      exposure_direction,
      source,
      review_status,
      notes
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
    ON CONFLICT(market, ticker) DO NOTHING
  `)

  db.exec("BEGIN")

  try {
    for (const profile of DEFAULT_EXPOSURE_PROFILES) {
      const normalized = normalizeExposureProfile(profile)

      statement.run(
        normalized.market,
        normalized.ticker,
        normalized.instrumentName,
        normalized.underlyingMarket,
        normalized.underlyingTicker,
        normalized.exposureMultiplier,
        normalized.exposureDirection,
        normalized.source,
        "reviewed",
        normalized.notes
      )
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

function readProfileFromDatabase(
  db: DatabaseSync,
  profile: UpsertInstrumentExposureProfile
) {
  const normalized = normalizeExposureProfile(profile)
  const row = db
    .prepare(
      `
      SELECT
        created_at,
        exposure_direction,
        exposure_multiplier,
        instrument_name,
        market,
        notes,
        source,
        ticker,
        underlying_market,
        underlying_ticker,
        updated_at
      FROM instrument_exposure_profiles
      WHERE market = ? AND ticker = ?
    `
    )
    .get(normalized.market, normalized.ticker) as
    | StoredExposureProfileRecord
    | undefined

  if (!row) {
    throw new Error("Unable to load the saved exposure profile.")
  }

  return mapStoredExposureProfile(row)
}

function readProfilesFromDatabase(db: DatabaseSync) {
  const rows = db
    .prepare(
      `
      SELECT
        created_at,
        exposure_direction,
        exposure_multiplier,
        instrument_name,
        market,
        notes,
        source,
        ticker,
        underlying_market,
        underlying_ticker,
        updated_at
      FROM instrument_exposure_profiles
      ORDER BY market ASC, ticker ASC
    `
    )
    .all() as StoredExposureProfileRecord[]

  return rows.map(mapStoredExposureProfile)
}

async function openExposureProfileDatabase(databasePath: string) {
  await mkdir(path.dirname(databasePath), { recursive: true })

  const db = new DatabaseSync(databasePath)
  createExposureProfileSchema(db)
  seedDefaultProfiles(db)

  return db
}

async function withExposureWriteLock<T>(work: () => Promise<T>) {
  const currentWrite = exposureWriteQueue.then(work)
  exposureWriteQueue = currentWrite.then(
    () => undefined,
    () => undefined
  )

  return currentWrite
}

export async function readInstrumentExposureProfiles(
  databasePath = getTradeStoreDatabasePath()
) {
  const db = await openExposureProfileDatabase(databasePath)

  try {
    return readProfilesFromDatabase(db)
  } finally {
    db.close()
  }
}

export async function upsertInstrumentExposureProfile(
  profile: UpsertInstrumentExposureProfile,
  databasePath = getTradeStoreDatabasePath()
) {
  return withExposureWriteLock(async () => {
    const db = await openExposureProfileDatabase(databasePath)

    try {
      upsertProfile(db, profile)

      return readProfileFromDatabase(db, profile)
    } finally {
      db.close()
    }
  })
}
