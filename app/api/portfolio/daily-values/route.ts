import { NextResponse } from "next/server"

import { computeDailyValuesFromTrades } from "@/lib/portfolio/daily-values-service"
import { readStoredTradeRows } from "@/lib/trades/storage"

export const dynamic = "force-dynamic"
export const maxDuration = 60
export const runtime = "nodejs"

export async function GET() {
  try {
    const trades = await readStoredTradeRows()
    const result = await computeDailyValuesFromTrades(trades)

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to compute daily portfolio values."

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
