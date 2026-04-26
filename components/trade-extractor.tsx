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
import { TradesTable } from "@/components/trades-table"
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
  deleteTradesResponseSchema,
  extractTradesResponseSchema,
  tradeRowsResponseSchema,
  type ExtractTradesResponse,
  type TradeTableRow,
} from "@/lib/trades/schema"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ChevronDown, Paperclip, TriangleAlert } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

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
        <p className="text-sm font-medium text-primary">
          {fileCount === 0
            ? "Drop screenshots or PDFs here."
            : `Ready to add ${fileCount} ${pluralize(fileCount, "file")}.`}
        </p>
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
  return (
    <details className="group px-4 pb-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
        Add context note
      </summary>
      <PromptInputTextarea
        className="mt-1 min-h-16 text-sm"
        placeholder="Example: ignore account summary totals and use only filled transactions."
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
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [deleteIssue, setDeleteIssue] = useState<string | null>(null)

  const accountOptions = useMemo(
    () =>
      [
        ...new Set(
          rows
            .map((row) => row.account)
            .filter((account): account is string => account !== null)
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [rows]
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

  const handleDeleteTrade = useCallback(async (id: string) => {
    setDeleteIssue(null)

    const response = await fetch("/api/trades/rows", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    })

    if (!response.ok) {
      const message = await readErrorMessage(response)
      setDeleteIssue(message)
      throw new Error(message)
    }

    const payload = await response.json()
    const parsed = deleteTradesResponseSchema.safeParse(payload)

    if (!parsed.success) {
      const message = "The server returned an unexpected response."
      setDeleteIssue(message)
      throw new Error(message)
    }

    setRows(parsed.data.rows)
  }, [])

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
          account: selectedAccount,
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
        `Added ${nextRows.length} confirmation ${pluralize(nextRows.length, "record")} from ${successfulFiles} ${pluralize(successfulFiles, "file")}.`
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
      <section className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">
            Ingest
          </p>
          <h2 className="text-lg font-medium tracking-tight">
            Add confirmations
          </h2>
        </div>

        {accountOptions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Account
            </span>
            <ToggleGroup
              onValueChange={(value) => setSelectedAccount(value || null)}
              size="sm"
              type="single"
              value={selectedAccount ?? ""}
              variant="outline"
            >
              {accountOptions.map((account) => (
                <ToggleGroupItem key={account} value={account}>
                  {account}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}

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
          <PromptInputFooter className="border-t px-4 py-3">
            <PromptInputTools>
              <span className="text-xs text-muted-foreground">
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
              {status === "ready" ? "Add confirmations" : "Adding..."}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
      </section>

      <TradesTable
        issues={successMessage ? issues : []}
        onDelete={handleDeleteTrade}
        restoreIssue={deleteIssue ?? restoreIssue}
        rows={rows}
        successMessage={successMessage}
      />
    </div>
  )
}
