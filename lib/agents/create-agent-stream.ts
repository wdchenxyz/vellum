import {
  convertToModelMessages,
  gateway,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai"

import { allTools, buildSystemPrompt } from "@/lib/agents/skills"
import { DEFAULT_MODEL } from "@/lib/trades/constants"

export async function createAgentStream(messages: UIMessage[]) {
  return streamText({
    model: gateway(DEFAULT_MODEL),
    system: buildSystemPrompt(),
    messages: await convertToModelMessages(messages),
    tools: allTools,
    stopWhen: stepCountIs(5),
  })
}
