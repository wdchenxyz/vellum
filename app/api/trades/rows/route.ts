import { NextResponse } from "next/server"

import { readStoredTradeRows } from "@/lib/trades/storage"

export const dynamic = "force-dynamic"
export const maxDuration = 30
export const runtime = "nodejs"

export async function GET() {
  try {
    const rows = await readStoredTradeRows()

    return NextResponse.json(
      { rows },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to load stored transactions."

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
