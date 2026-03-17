export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6"

export const UPLOAD_ACCEPT = "image/*,application/pdf"

export const MAX_FILES = 4
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024
export const MAX_BATCH_SIZE_BYTES = 6 * 1024 * 1024

export const MAX_FILE_SIZE_LABEL = "2 MB"
export const MAX_BATCH_SIZE_LABEL = "6 MB"

export function isAcceptedTradeMediaType(mediaType: string) {
  return mediaType.startsWith("image/") || mediaType === "application/pdf"
}
