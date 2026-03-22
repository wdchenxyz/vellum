import { NextResponse, type NextRequest } from "next/server"

import { deleteTradesRequestSchema } from "@/lib/trades/schema"
import {
  deleteStoredTradeRows,
  readStoredTradeRows,
} from "@/lib/trades/storage"

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

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = deleteTradesRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "A non-empty list of trade IDs is required." },
        { status: 400 }
      )
    }

    const rows = await deleteStoredTradeRows(parsed.data.ids)

    return NextResponse.json({ rows })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to delete the requested trades."

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
