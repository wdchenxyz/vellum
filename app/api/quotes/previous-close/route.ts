import { NextResponse } from "next/server"

import {
  previousCloseRequestSchema,
  type PreviousCloseLookupTarget,
} from "@/lib/portfolio/schema"
import { fetchPreviousCloseSnapshots } from "@/lib/quotes/twelve-data"

export const maxDuration = 30

function dedupeTargets(targets: PreviousCloseLookupTarget[]) {
  const seen = new Set<string>()
  const deduped: PreviousCloseLookupTarget[] = []

  for (const target of targets) {
    const key = `${target.market}:${target.ticker.trim().toUpperCase()}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push({
      ...target,
      ticker: target.ticker.trim().toUpperCase(),
    })
  }

  return deduped
}

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

  const parsed = previousCloseRequestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please send at least one supported portfolio target." },
      { status: 400 }
    )
  }

  try {
    const quotes = await fetchPreviousCloseSnapshots(
      dedupeTargets(parsed.data.targets)
    )

    return NextResponse.json({ quotes })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to load previous close prices."

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
