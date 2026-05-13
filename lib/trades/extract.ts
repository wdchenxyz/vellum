import "server-only"

import { generateText, gateway, Output } from "ai"

import { DEFAULT_MODEL, isAcceptedTradeMediaType } from "@/lib/trades/constants"
import {
  extractedTradesEnvelopeSchema,
  type ExtractedTrade,
  type FileExtractionResult,
  type TradeFileInput,
} from "@/lib/trades/schema"

const EXTRACTION_INSTRUCTIONS = [
  "Extract every clearly visible securities transaction from the uploaded file.",
  "A file may contain multiple transactions, so return all of them.",
  "Only return BUY or SELL trades that are actually visible.",
  "Normalize the date to YYYY-MM-DD when possible.",
  "For Taiwan-listed securities, prefer the numeric stock code in the ticker field when it is visible; otherwise use the visible stock name.",
  "If a security name is visible, return it in securityName, even when it is truncated.",
  "For ETFs, ETNs, leveraged funds, or inverse funds, do not use an underlying stock symbol embedded in the fund name as the traded ticker unless the actual ticker is visibly shown standalone.",
  "If the actual traded ticker is not visible for a fund, put the visible fund name in ticker.",
  "Omit tickerCandidates unless a short candidate ticker is explicitly printed separately from the security name.",
  "Normalize ticker and currency to uppercase.",
  "Return quantity, price, and fee as plain numbers without commas or symbols.",
  "Return settlementAmount as the absolute total payable or receivable amount for the trade when it is visible in the row or details.",
  "If a row shows total payable/receivable amount but hides the fee, derive the fee from the absolute total minus price times quantity when that arithmetic is clear; otherwise leave fee null.",
  "Keep quantity positive. The side field carries the direction.",
  "Use null for currency or fee when a value is missing or unreadable.",
  'If the file does not contain any valid transactions, return {"trades":[]}.',
  "Do not guess or invent values.",
].join("\n")

function getFileName(file: TradeFileInput) {
  return file.filename ?? "uploaded-file"
}

function getModelInputData(file: TradeFileInput) {
  if (file.url.startsWith("data:")) {
    return file.url
  }

  if (file.url.startsWith("https://") || file.url.startsWith("http://")) {
    return new URL(file.url)
  }

  throw new Error(
    "The uploaded file could not be encoded for the model. Please retry with a smaller image or PDF."
  )
}

function getModelInputPart(file: TradeFileInput) {
  const data = getModelInputData(file)

  if (file.mediaType.startsWith("image/")) {
    return {
      image: data,
      mediaType: file.mediaType,
      type: "image" as const,
    }
  }

  return {
    data,
    filename: file.filename,
    mediaType: file.mediaType,
    type: "file" as const,
  }
}

function normalizeNullableString(value: string | null) {
  if (!value) {
    return null
  }

  const normalized = value.trim().toUpperCase()
  return normalized.length > 0 ? normalized : null
}

function normalizeOptionalNullableString(value: string | null | undefined) {
  return normalizeNullableString(value ?? null)
}

function normalizeTrade(trade: ExtractedTrade): ExtractedTrade {
  return {
    date: trade.date.trim(),
    ticker: trade.ticker.trim().toUpperCase(),
    securityName: normalizeOptionalNullableString(trade.securityName),
    tickerCandidates: (trade.tickerCandidates ?? []).map((candidate) => ({
      confidence: candidate.confidence ?? null,
      reason: candidate.reason?.trim() || null,
      ticker: candidate.ticker.trim().toUpperCase(),
    })),
    quantity: trade.quantity,
    price: trade.price,
    currency: normalizeNullableString(trade.currency),
    fee: trade.fee,
    settlementAmount: trade.settlementAmount ?? null,
    side: trade.side,
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "The model could not extract transactions from this file."
}

type ExtractionFinishSummary = {
  finishReason: string
  rawFinishReason: string | null
  textLength: number
}

function formatIncompleteOutputMessage(
  finish: ExtractionFinishSummary | null
) {
  if (!finish) {
    return "The model did not return a structured extraction result."
  }

  const rawReason = finish.rawFinishReason
    ? `, provider reason ${finish.rawFinishReason}`
    : ""

  return `The model stopped before returning a structured extraction result (${finish.finishReason}${rawReason}, ${finish.textLength} text characters).`
}

export async function extractTradesFromFile({
  file,
  prompt,
}: {
  file: TradeFileInput
  prompt: string
}): Promise<FileExtractionResult> {
  const fileName = getFileName(file)

  if (!isAcceptedTradeMediaType(file.mediaType)) {
    return {
      fileName,
      trades: [],
      error: "Only images and PDF files are supported in this MVP.",
    }
  }

  let finishSummary: ExtractionFinishSummary | null = null

  try {
    const result = await generateText({
      model: gateway(DEFAULT_MODEL),
      temperature: 0,
      maxOutputTokens: 6000,
      output: Output.object({
        schema: extractedTradesEnvelopeSchema,
        name: "trade_extraction",
        description:
          "One or more securities trades extracted from a screenshot or PDF.",
      }),
      onFinish: ({ finishReason, rawFinishReason, text }) => {
        finishSummary = {
          finishReason,
          rawFinishReason: rawFinishReason ?? null,
          textLength: text.length,
        }
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                EXTRACTION_INSTRUCTIONS,
                `File name: ${fileName}`,
                prompt.trim()
                  ? `User note: ${prompt.trim()}`
                  : "User note: none provided.",
              ].join("\n\n"),
            },
            getModelInputPart(file),
          ],
        },
      ],
    })

    if (result.finishReason !== "stop") {
      return {
        fileName,
        trades: [],
        error: formatIncompleteOutputMessage(finishSummary),
      }
    }

    return {
      fileName,
      trades: result.output.trades.map(normalizeTrade),
    }
  } catch (error) {
    return {
      fileName,
      trades: [],
      error:
        getErrorMessage(error) === "No output generated."
          ? formatIncompleteOutputMessage(finishSummary)
          : getErrorMessage(error),
    }
  }
}
