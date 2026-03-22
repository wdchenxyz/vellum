"use client"

import type { ChatStatus } from "ai"
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input"
import { HoldingsTable } from "@/components/holdings-table"
import { PortfolioSummaryCards } from "@/components/portfolio-summary-cards"
import { TradesTable } from "@/components/trades-table"
import {
  aggregateHoldings,
  applyPreviousCloseQuotes,
} from "@/lib/portfolio/holdings"
import {
  fxRateResponseSchema,
  type FxRateSnapshot,
  previousCloseResponseSchema,
  type PreviousCloseQuote,
} from "@/lib/portfolio/schema"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  MAX_BATCH_SIZE_LABEL,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  MAX_FILES,
  UPLOAD_ACCEPT,
} from "@/lib/trades/constants"
import {
  extractTradesResponseSchema,
  tradeRowsResponseSchema,
  type ExtractTradesResponse,
  type TradeTableRow,
} from "@/lib/trades/schema"
import { ChevronDown, Paperclip, TriangleAlert } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return value === 1 ? singular : plural
}

function formatPromptInputError(
  code: "accept" | "max_file_size" | "max_files"
) {
  switch (code) {
    case "accept":
      return "Only images and PDF files are supported."
    case "max_file_size":
      return `Each file must stay under ${MAX_FILE_SIZE_LABEL}.`
    case "max_files":
      return `Please upload ${MAX_FILES} ${pluralize(MAX_FILES, "file")} or fewer per batch.`
    default:
      return "The selected files could not be added."
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "The request failed."
}

function BrowseFilesButton() {
  const attachments = usePromptInputAttachments()

  return (
    <Button
      className="border-primary/20 bg-primary/5 text-primary hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
      onClick={() => attachments.openFileDialog()}
      size="sm"
      type="button"
      variant="outline"
    >
      <Paperclip className="size-4" />
      Choose files
    </Button>
  )
}

function AttachmentTray() {
  const attachments = usePromptInputAttachments()
  const fileCount = attachments.files.length

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">
            {fileCount === 0
              ? "Drop screenshots or PDFs here."
              : `Ready to extract ${fileCount} ${pluralize(fileCount, "file")}.`}
          </p>
          <p className="text-xs text-muted-foreground">
            {fileCount === 0
              ? "Drag files into this box or browse from your device."
              : "Remove anything you do not want to process before submitting."}
          </p>
        </div>
        <BrowseFilesButton />
      </div>

      {fileCount > 0 ? (
        <Attachments variant="inline">
          {attachments.files.map((attachment) => (
            <Attachment
              data={attachment}
              key={attachment.id}
              onRemove={() => attachments.remove(attachment.id)}
            >
              <AttachmentPreview />
              <AttachmentInfo />
              <AttachmentRemove />
            </Attachment>
          ))}
        </Attachments>
      ) : null}
    </div>
  )
}

function OptionalNote() {
  const textareaId = useId()
  const descriptionId = `${textareaId}-description`

  return (
    <details className="group border-t border-border/70 bg-secondary/15 px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-secondary-foreground">
        <span>
          Add context note{" "}
          <span className="font-normal text-muted-foreground">Optional</span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <label
        className="mt-2 block text-sm font-medium text-foreground"
        htmlFor={textareaId}
      >
        Context note
      </label>
      <p
        className="mt-1 max-w-2xl text-sm text-muted-foreground"
        id={descriptionId}
      >
        Use this only when the document needs extra context.
      </p>
      <PromptInputTextarea
        aria-describedby={descriptionId}
        className="mt-3 min-h-20"
        id={textareaId}
        placeholder="Example: ignore account summary totals and extract only filled trades."
      />
    </details>
  )
}

async function readErrorMessage(response: Response) {
  const payload = await response.json().catch(() => null)

  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error
  }

  return `Request failed with status ${response.status}.`
}

function toTableRows(response: ExtractTradesResponse) {
  return response.rows
}

function toIssues(response: ExtractTradesResponse) {
  return response.results.flatMap((result) => {
    if (result.error) {
      return [`${result.fileName}: ${result.error}`]
    }

    if (result.trades.length === 0) {
      return [
        `${result.fileName}: no visible BUY or SELL transactions were found.`,
      ]
    }

    return []
  })
}

function mergeTradeRows(
  existingRows: TradeTableRow[],
  nextRows: TradeTableRow[]
) {
  const rowsById = new Map(existingRows.map((row) => [row.id, row]))

  for (const row of nextRows) {
    rowsById.set(row.id, row)
  }

  return [...rowsById.values()]
}

export function TradeExtractor() {
  const [rows, setRows] = useState<TradeTableRow[]>([])
  const [status, setStatus] = useState<ChatStatus>("ready")
  const [uploadIssue, setUploadIssue] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [restoreIssue, setRestoreIssue] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [quotesByKey, setQuotesByKey] = useState<
    Record<string, PreviousCloseQuote>
  >({})
  const [quoteStatus, setQuoteStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle")
  const [quoteRequestIssue, setQuoteRequestIssue] = useState<string | null>(
    null
  )
  const [fxSnapshot, setFxSnapshot] = useState<FxRateSnapshot | null>(null)
  const [fxStatus, setFxStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle")
  const [fxIssue, setFxIssue] = useState<string | null>(null)

  const aggregatedPortfolio = useMemo(() => aggregateHoldings(rows), [rows])
  const valuedPortfolio = useMemo(
    () => applyPreviousCloseQuotes(aggregatedPortfolio.holdings, quotesByKey),
    [aggregatedPortfolio.holdings, quotesByKey]
  )
  const hasUsdBucket = valuedPortfolio.groups.some((group) =>
    group.currencies.includes("USD")
  )
  const needsUsdTwdFxSnapshot = hasUsdBucket
  const missingQuoteTargets = useMemo(
    () =>
      aggregatedPortfolio.holdings
        .filter((holding) => !quotesByKey[holding.quoteKey])
        .map((holding) => ({
          market: holding.market,
          ticker: holding.ticker,
        })),
    [aggregatedPortfolio.holdings, quotesByKey]
  )

  useEffect(() => {
    let cancelled = false

    async function loadStoredTrades() {
      try {
        const response = await fetch("/api/trades/rows", {
          cache: "no-store",
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }

        const payload = await response.json()
        const parsed = tradeRowsResponseSchema.safeParse(payload)

        if (!parsed.success) {
          throw new Error(
            "The server returned an unexpected transactions response."
          )
        }

        if (cancelled) {
          return
        }

        setRows((currentRows) => mergeTradeRows(currentRows, parsed.data.rows))
        setRestoreIssue(null)
      } catch (error) {
        if (cancelled) {
          return
        }

        setRestoreIssue(getErrorMessage(error))
      }
    }

    void loadStoredTrades()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!needsUsdTwdFxSnapshot) {
      setFxStatus("idle")
      setFxIssue(null)
      return
    }

    if (fxSnapshot) {
      setFxStatus("ready")
      return
    }

    let cancelled = false

    async function loadFxSnapshot() {
      setFxStatus("loading")
      setFxIssue(null)

      try {
        const response = await fetch("/api/quotes/fx-rate", {
          cache: "no-store",
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }

        const payload = await response.json()
        const parsed = fxRateResponseSchema.safeParse(payload)

        if (!parsed.success) {
          throw new Error("The server returned an unexpected FX response.")
        }

        if (cancelled) {
          return
        }

        setFxSnapshot(parsed.data.snapshot)
        setFxStatus("ready")
      } catch (error) {
        if (cancelled) {
          return
        }

        setFxStatus("error")
        setFxIssue(getErrorMessage(error))
      }
    }

    void loadFxSnapshot()

    return () => {
      cancelled = true
    }
  }, [fxSnapshot, needsUsdTwdFxSnapshot])

  useEffect(() => {
    if (aggregatedPortfolio.holdings.length === 0) {
      setQuoteStatus("idle")
      setQuoteRequestIssue(null)
      return
    }

    if (missingQuoteTargets.length === 0) {
      setQuoteStatus("ready")
      return
    }

    let cancelled = false

    async function loadPreviousCloses() {
      setQuoteStatus("loading")
      setQuoteRequestIssue(null)

      try {
        const response = await fetch("/api/quotes/previous-close", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ targets: missingQuoteTargets }),
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }

        const payload = await response.json()
        const parsed = previousCloseResponseSchema.safeParse(payload)

        if (!parsed.success) {
          throw new Error("The server returned an unexpected price response.")
        }

        if (cancelled) {
          return
        }

        setQuotesByKey((currentQuotes) => {
          const nextQuotes = { ...currentQuotes }

          for (const quote of parsed.data.quotes) {
            nextQuotes[quote.key] = quote
          }

          return nextQuotes
        })
        setQuoteStatus("ready")
      } catch (error) {
        if (cancelled) {
          return
        }

        setQuoteStatus("error")
        setQuoteRequestIssue(getErrorMessage(error))
      }
    }

    void loadPreviousCloses()

    return () => {
      cancelled = true
    }
  }, [aggregatedPortfolio.holdings.length, missingQuoteTargets])

  async function handleSubmit(message: PromptInputMessage) {
    if (message.files.length === 0) {
      const issue = "Add at least one image or PDF before submitting."
      setUploadIssue(issue)
      setSuccessMessage(null)
      throw new Error(issue)
    }

    setStatus("submitted")
    setUploadIssue(null)
    setIssues([])
    setSuccessMessage(null)

    try {
      const response = await fetch("/api/trades/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: message.text,
          files: message.files,
        }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response))
      }

      const payload = await response.json()
      const parsed = extractTradesResponseSchema.safeParse(payload)

      if (!parsed.success) {
        throw new Error("The server returned an unexpected response.")
      }

      const nextRows = toTableRows(parsed.data)
      const nextIssues = toIssues(parsed.data)

      if (nextRows.length === 0) {
        const issue =
          nextIssues[0] ??
          "No visible BUY or SELL transactions were found in the uploaded files."

        setUploadIssue(issue)
        setIssues(nextIssues)

        throw new Error(issue)
      }

      const successfulFiles = parsed.data.results.filter(
        (result) => result.trades.length > 0
      ).length

      setRows((currentRows) => mergeTradeRows(currentRows, nextRows))
      setIssues(nextIssues)
      setSuccessMessage(
        `Added ${nextRows.length} ${pluralize(nextRows.length, "trade")} from ${successfulFiles} ${pluralize(successfulFiles, "file")}.`
      )
    } catch (error) {
      setSuccessMessage(null)
      setUploadIssue(getErrorMessage(error))

      throw error
    } finally {
      setStatus("ready")
    }
  }

  return (
    <div className="grid gap-8">
      {rows.length > 0 ? (
        <PortfolioSummaryCards
          fxSnapshot={fxSnapshot}
          holdings={valuedPortfolio.holdings}
        />
      ) : null}

      <section className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">
            Ingest
          </p>
          <h2 className="text-lg font-medium tracking-tight">
            Add confirmations
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Start with the files. Add a note only when the document needs extra
            context.
          </p>
        </div>

        {uploadIssue ? (
          <Alert
            className="border-destructive/30 bg-destructive/5"
            variant="destructive"
          >
            <TriangleAlert className="size-4" />
            <AlertTitle>
              {issues.length > 0 ? "Review these files" : "Upload blocked"}
            </AlertTitle>
            <AlertDescription>
              {issues.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {issues.map((issue) => (
                    <p key={issue}>{issue}</p>
                  ))}
                </div>
              ) : (
                uploadIssue
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <PromptInput
          accept={UPLOAD_ACCEPT}
          inputGroupClassName="surface-upload rounded-xl border-primary/20"
          maxFiles={MAX_FILES}
          maxFileSize={MAX_FILE_SIZE_BYTES}
          multiple
          onError={(error) => {
            setUploadIssue(formatPromptInputError(error.code))
            setIssues([])
            setSuccessMessage(null)
          }}
          onSubmit={handleSubmit}
        >
          <PromptInputHeader className="px-4 py-4">
            <AttachmentTray />
          </PromptInputHeader>
          <PromptInputBody>
            <OptionalNote />
          </PromptInputBody>
          <PromptInputFooter className="border-t border-border/70 bg-secondary/15 px-4 py-3">
            <PromptInputTools>
              <span className="text-xs text-secondary-foreground/80">
                {MAX_FILES} files max • {MAX_FILE_SIZE_LABEL} each •{" "}
                {MAX_BATCH_SIZE_LABEL} total
              </span>
            </PromptInputTools>
            <PromptInputSubmit
              className="shadow-primary-soft"
              disabled={status !== "ready"}
              size="sm"
              status={status}
            >
              {status === "ready" ? "Extract trades" : "Extracting..."}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
      </section>

      {rows.length > 0 ? (
        <HoldingsTable
          fxIssue={fxIssue}
          fxSnapshot={fxSnapshot}
          fxStatus={fxStatus}
          groups={valuedPortfolio.groups}
          holdings={valuedPortfolio.holdings}
          issues={aggregatedPortfolio.issues}
          requestError={quoteRequestIssue}
          status={quoteStatus}
          summaries={valuedPortfolio.summaries}
        />
      ) : null}

      <TradesTable
        issues={successMessage ? issues : []}
        restoreIssue={restoreIssue}
        rows={rows}
        successMessage={successMessage}
      />
    </div>
  )
}
