// lib/agents/skills/types.ts
import type { ToolSet } from "ai"

export interface Skill<T extends ToolSet = ToolSet> {
  /** Unique identifier for this skill */
  name: string
  /** Human-readable description (used for logging/debugging) */
  description: string
  /** Tool definitions belonging to this skill */
  tools: T
  /** Domain-specific system prompt fragment appended when this skill is active */
  systemPrompt: string
}
