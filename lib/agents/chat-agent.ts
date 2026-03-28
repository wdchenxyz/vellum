// lib/agents/chat-agent.ts
// Re-exports from the skill registry for backward compatibility.
import { allTools, type AllToolsParts, buildSystemPrompt } from "./skills"

export { allTools as chatTools, buildSystemPrompt }
export type { AllToolsParts as ChatToolsParts }

// Kept as a named export for any callers that used CHAT_SYSTEM_PROMPT directly.
export const CHAT_SYSTEM_PROMPT = buildSystemPrompt()
