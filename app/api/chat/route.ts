import {
  convertToModelMessages,
  gateway,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai"

import { allTools, buildSystemPrompt } from "@/lib/agents/skills"
import { DEFAULT_MODEL } from "@/lib/trades/constants"

export const maxDuration = 60

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json()

  const result = streamText({
    model: gateway(DEFAULT_MODEL),
    system: buildSystemPrompt(),
    messages: await convertToModelMessages(messages),
    tools: allTools,
    stopWhen: stepCountIs(5),
  })

  return result.toUIMessageStreamResponse()
}
