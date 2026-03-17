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
  "Normalize ticker and currency to uppercase.",
  "Return quantity, price, and fee as plain numbers without commas or symbols.",
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

function normalizeNullableString(value: string | null) {
  if (!value) {
    return null
  }

  const normalized = value.trim().toUpperCase()
  return normalized.length > 0 ? normalized : null
}

function normalizeTrade(trade: ExtractedTrade): ExtractedTrade {
  return {
    date: trade.date.trim(),
    ticker: trade.ticker.trim().toUpperCase(),
    quantity: trade.quantity,
    price: trade.price,
    currency: normalizeNullableString(trade.currency),
    fee: trade.fee,
    side: trade.side,
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "The model could not extract transactions from this file."
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

  try {
    const result = await generateText({
      model: gateway(DEFAULT_MODEL),
      temperature: 0,
      maxOutputTokens: 2000,
      output: Output.object({
        schema: extractedTradesEnvelopeSchema,
        name: "trade_extraction",
        description:
          "One or more securities trades extracted from a screenshot or PDF.",
      }),
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
            {
              type: "file",
              data: getModelInputData(file),
              mediaType: file.mediaType,
            },
          ],
        },
      ],
    })

    return {
      fileName,
      trades: result.output.trades.map(normalizeTrade),
    }
  } catch (error) {
    return {
      fileName,
      trades: [],
      error: getErrorMessage(error),
    }
  }
}
