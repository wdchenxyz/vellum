import { NextResponse } from "next/server"

import { captureTradeConfirmations } from "@/lib/trades/capture"

export const maxDuration = 60
export const runtime = "nodejs"

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400 }
    )
  }

  const result = await captureTradeConfirmations(body)

  if (result.status === "rejected") {
    return NextResponse.json(
      { error: result.error },
      { status: result.kind === "persistence-failed" ? 500 : 400 }
    )
  }

  return NextResponse.json(result.response)
}
