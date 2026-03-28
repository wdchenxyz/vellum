import { tool } from "ai"
import { z } from "zod"

import { extractContent } from "@/lib/news/jina-reader"

export const fetchNewsContent = tool({
  description:
    "Extract the full article content from a news URL. Returns the article text in markdown format. Use this when the user wants to read a specific article from the news headlines. The URL should come from a previous fetchHotNews or getUnifiedTrends result.",
  inputSchema: z.object({
    url: z
      .string()
      .url()
      .describe("The full URL of the article to extract content from"),
  }),
  execute: async ({ url }) => {
    const content = await extractContent(url)

    if (!content) {
      return {
        success: false,
        error: "Failed to extract content from this URL.",
      }
    }

    // Truncate very long articles to avoid overwhelming the context
    const maxLength = 8000
    const truncated = content.length > maxLength
    const text = truncated ? content.slice(0, maxLength) + "\n\n[Truncated]" : content

    return {
      success: true,
      url,
      contentLength: content.length,
      truncated,
      content: text,
    }
  },
})
