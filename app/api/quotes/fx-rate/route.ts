import { NextResponse } from "next/server"

import { fetchUsdTwdFxSnapshot } from "@/lib/quotes/twelve-data"

export const dynamic = "force-dynamic"
export const maxDuration = 30
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const forceRefresh = url.searchParams.get("forceRefresh") === "true"
    const snapshot = await fetchUsdTwdFxSnapshot(fetch, { forceRefresh })

    return NextResponse.json(
      { snapshot },
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
        : "Unable to load the USD/TWD FX snapshot."

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
