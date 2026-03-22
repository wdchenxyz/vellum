import { NextResponse } from "next/server"

import {
  MAX_BATCH_SIZE_BYTES,
  MAX_BATCH_SIZE_LABEL,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  isAcceptedTradeMediaType,
} from "@/lib/trades/constants"
import { extractTradesFromFile } from "@/lib/trades/extract"
import {
  computeTradeTotalAmount,
  extractTradesRequestSchema,
  type FileExtractionResult,
  type TradeTableRow,
} from "@/lib/trades/schema"
import { appendStoredTradeRows } from "@/lib/trades/storage"

export const maxDuration = 60
export const runtime = "nodejs"

function getDataUrlByteLength(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",")

  if (commaIndex === -1) {
    throw new Error("Invalid file payload.")
  }

  return Buffer.from(dataUrl.slice(commaIndex + 1), "base64").byteLength
}

function validateUploads(files: Array<{ mediaType: string; url: string }>) {
  let totalBytes = 0

  for (const file of files) {
    if (!isAcceptedTradeMediaType(file.mediaType)) {
      return "Only images and PDF files are supported in this MVP."
    }

    if (!file.url.startsWith("data:")) {
      return "Uploads must be sent as embedded data URLs. Please reselect the file and try again."
    }

    const fileSize = getDataUrlByteLength(file.url)

    if (fileSize > MAX_FILE_SIZE_BYTES) {
      return `Each file must stay under ${MAX_FILE_SIZE_LABEL}.`
    }

    totalBytes += fileSize
  }

  if (totalBytes > MAX_BATCH_SIZE_BYTES) {
    return `Please keep each batch under ${MAX_BATCH_SIZE_LABEL} total.`
  }

  return null
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

  const parsed = extractTradesRequestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please send at least one image or PDF file." },
      { status: 400 }
    )
  }

  const uploadError = validateUploads(parsed.data.files)

  if (uploadError) {
    return NextResponse.json({ error: uploadError }, { status: 400 })
  }

  const results: FileExtractionResult[] = []

  for (const file of parsed.data.files) {
    results.push(
      await extractTradesFromFile({ file, prompt: parsed.data.prompt })
    )
  }

  const account = parsed.data.account ?? null

  const rows: TradeTableRow[] = results.flatMap((result) =>
    result.trades.map((trade) => ({
      account,
      currency: trade.currency,
      date: trade.date,
      id: crypto.randomUUID(),
      price: trade.price,
      quantity: trade.quantity,
      side: trade.side,
      sourceFile: result.fileName,
      ticker: trade.ticker,
      totalAmount: computeTradeTotalAmount({
        fee: trade.fee,
        price: trade.price,
        quantity: trade.quantity,
        side: trade.side,
      }),
    }))
  )

  try {
    await appendStoredTradeRows(rows)
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to persist extracted transactions."

    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ results, rows })
}
