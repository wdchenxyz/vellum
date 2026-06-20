import type { UIMessage } from "ai"
import { NextResponse } from "next/server"

import { isPortfolioAssistantEnabled } from "@/lib/agents/config"
import { createAgentStream } from "@/lib/agents/create-agent-stream"

export const maxDuration = 60

export async function POST(request: Request) {
  if (!isPortfolioAssistantEnabled()) {
    return NextResponse.json(
      { error: "Portfolio Assistant is not configured for this deployment." },
      { status: 503 }
    )
  }

  const { messages }: { messages: UIMessage[] } = await request.json()
  const result = await createAgentStream(messages)
  return result.toTextStreamResponse()
}
