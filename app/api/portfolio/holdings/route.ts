import { NextResponse } from "next/server"

import { getCurrentHoldings } from "@/lib/portfolio/current-holdings"

export const dynamic = "force-dynamic"
export const maxDuration = 60
export const runtime = "nodejs"

function getOptionalFilter(url: URL, name: string) {
  return url.searchParams.get(name)?.trim() || undefined
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const forceRefreshValue = url.searchParams.get("forceRefresh")

  if (
    forceRefreshValue !== null &&
    forceRefreshValue !== "true" &&
    forceRefreshValue !== "false"
  ) {
    return NextResponse.json(
      { error: "forceRefresh must be true or false." },
      { status: 400 }
    )
  }

  try {
    const result = await getCurrentHoldings({
      account: getOptionalFilter(url, "account"),
      forceRefresh: forceRefreshValue === "true",
      ticker: getOptionalFilter(url, "ticker"),
    })

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to load current holdings."

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
