import "server-only"

import {
  MAX_BATCH_SIZE_BYTES,
  MAX_BATCH_SIZE_LABEL,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  isAcceptedTradeMediaType,
} from "@/lib/trades/constants"
import { extractTradesFromFile } from "@/lib/trades/extract"
import { resolveExtractedTradeTicker } from "@/lib/trades/resolve-ticker"
import {
  computeTradeTotalAmount,
  extractTradesRequestSchema,
  type ExtractedTrade,
  type ExtractTradesResponse,
  type FileExtractionResult,
  type TradeFileInput,
  type TradeTableRow,
} from "@/lib/trades/schema"
import { appendStoredTradeRows } from "@/lib/trades/storage"

export type TradeCaptureFailureKind =
  | "invalid-request"
  | "invalid-upload"
  | "persistence-failed"

export type TradeCaptureResult =
  | {
      response: ExtractTradesResponse
      status: "captured"
    }
  | {
      error: string
      kind: TradeCaptureFailureKind
      status: "rejected"
    }

function rejectTradeCapture(
  kind: TradeCaptureFailureKind,
  error: string
): TradeCaptureResult {
  return {
    error,
    kind,
    status: "rejected",
  }
}

function getDataUrlByteLength(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",")

  if (commaIndex === -1) {
    throw new Error("Invalid file payload.")
  }

  return Buffer.from(dataUrl.slice(commaIndex + 1), "base64").byteLength
}

function getUploadByteLength(dataUrl: string) {
  try {
    return getDataUrlByteLength(dataUrl)
  } catch {
    return null
  }
}

function validateTradeConfirmations(
  files: Array<{ mediaType: string; url: string }>
) {
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

async function resolveTickerForResult(result: FileExtractionResult) {
  const resolvedTrades: ExtractedTrade[] = []
  const issues: string[] = []

  for (const trade of result.trades) {
    const resolution = await resolveExtractedTradeTicker({ trade })

    if (resolution.status === "accepted") {
      resolvedTrades.push(resolution.trade)
      continue
    }

    issues.push(resolution.issue)
  }

  return {
    ...result,
    error: [result.error, ...issues].filter(Boolean).join(" ") || undefined,
    trades: resolvedTrades,
  }
}

async function extractTradeConfirmations({
  files,
  prompt,
}: {
  files: TradeFileInput[]
  prompt: string
}) {
  const results: FileExtractionResult[] = []

  for (const file of files) {
    results.push(
      await resolveTickerForResult(await extractTradesFromFile({ file, prompt }))
    )
  }

  return results
}

function warnAboutEmptyExtractionResults(
  files: TradeFileInput[],
  results: FileExtractionResult[]
) {
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    const file = files[index]

    if (result.error || result.trades.length === 0) {
      console.warn("[trades/extract] no persisted trades for uploaded file", {
        error: result.error ?? null,
        fileName: result.fileName,
        mediaType: file?.mediaType ?? null,
        sizeBytes: file ? getUploadByteLength(file.url) : null,
        tradeCount: result.trades.length,
      })
    }
  }
}

function buildSavedTradeRows({
  account,
  results,
}: {
  account: string | null
  results: FileExtractionResult[]
}) {
  return results.flatMap((result) =>
    result.trades.map(
      (trade): TradeTableRow => ({
        account,
        currency: trade.currency,
        date: trade.date,
        id: crypto.randomUUID(),
        price: trade.price,
        quantity: trade.quantity,
        side: trade.side,
        sourceFile: result.fileName,
        ticker: trade.ticker,
        totalAmount:
          trade.settlementAmount ??
          computeTradeTotalAmount({
            fee: trade.fee,
            price: trade.price,
            quantity: trade.quantity,
            side: trade.side,
          }),
      })
    )
  )
}

function getPersistenceErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Unable to persist extracted transactions."
}

export async function captureTradeConfirmations(
  body: unknown
): Promise<TradeCaptureResult> {
  const parsed = extractTradesRequestSchema.safeParse(body)

  if (!parsed.success) {
    return rejectTradeCapture(
      "invalid-request",
      "Please send at least one image or PDF file."
    )
  }

  const uploadError = validateTradeConfirmations(parsed.data.files)

  if (uploadError) {
    return rejectTradeCapture("invalid-upload", uploadError)
  }

  const results = await extractTradeConfirmations({
    files: parsed.data.files,
    prompt: parsed.data.prompt,
  })

  warnAboutEmptyExtractionResults(parsed.data.files, results)

  const rows = buildSavedTradeRows({
    account: parsed.data.account ?? null,
    results,
  })

  try {
    await appendStoredTradeRows(rows)
  } catch (error) {
    return rejectTradeCapture(
      "persistence-failed",
      getPersistenceErrorMessage(error)
    )
  }

  return {
    response: { results, rows },
    status: "captured",
  }
}
