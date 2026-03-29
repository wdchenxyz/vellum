import type { UIMessage } from "ai"

import { createAgentStream } from "@/lib/agents/create-agent-stream"

export const maxDuration = 60

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json()
  const result = await createAgentStream(messages)
  return result.toTextStreamResponse()
}
