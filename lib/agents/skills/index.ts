import type { InferUITools, ToolSet } from "ai"

import type { Skill } from "./types"
import { portfolioSkill } from "./portfolio"

// --- Skill Registry ---
// To add a new skill, import it and add it to this array.
export const skills: Skill[] = [portfolioSkill]

// --- Merged Tools ---
// Union of all tools across all skills, passed to streamText().
function mergeTools(skillList: Skill[]): ToolSet {
  const merged: ToolSet = {}
  for (const skill of skillList) {
    for (const key of Object.keys(skill.tools)) {
      if (key in merged) {
        throw new Error(
          `Tool name collision: "${key}" is defined in multiple skills`
        )
      }
    }
    Object.assign(merged, skill.tools)
  }
  return merged
}

export const allTools = mergeTools(skills)
export type AllToolsParts = InferUITools<typeof allTools>

// --- Merged Tool Labels ---
// Re-exported from tool-labels.ts (client-safe, no server-only imports).
// Client components should import from "@/lib/agents/skills/tool-labels" directly.
export { allToolLabels } from "./tool-labels"

// --- Base System Prompt ---
// Product knowledge and behavioral rules shared across all skills.
// Skill-specific prompts are appended by prepareStep when the skill is active.
export const BASE_SYSTEM_PROMPT = `<rules>
You are the built-in assistant for Vellum. You can answer questions about the product itself AND analyze the user's portfolio data.

If the user asks anything completely unrelated to Vellum or investing (e.g. general knowledge, coding help, personal advice, creative writing, etc.), politely decline and redirect them. For example: "I can help with anything about Vellum or your portfolio. What would you like to know?"

You must ALWAYS use tools to fetch real data before answering data questions. Never fabricate numbers, prices, or performance metrics.

Do not use emojis.

Today's date is ${new Date().toISOString().slice(0, 10)}.
</rules>

<product>
Vellum is a personal investment tracking tool. Here is how it works:

**Uploading trades (Ingest)**
- On the main page there is a file upload area where the user can drag-and-drop or paste screenshots and PDFs of trade confirmations.
- Supported file types: images (PNG, JPEG, etc.) and PDF. Up to 4 files at a time, each max 2 MB (6 MB total per batch).
- The user can optionally select a brokerage account label and add a context note before submitting.
- An AI model reads the uploaded files and extracts structured trade data (date, ticker, side, quantity, price, currency, fee) automatically.
- Extracted trades appear in the trades table below the upload area. The user can review and delete any incorrect rows.

**Portfolio dashboard**
- Once trades are ingested, Vellum shows:
  - **Holdings table**: current open positions grouped by account, with ticker, quantity, average cost, previous close price, market value, weight, and unrealized P&L.
  - **Portfolio summary cards**: total cost basis and total market value per account.
  - **Asset value chart**: daily portfolio value over time (in TWD), overlaid with cash-flow-adjusted S&P 500 and TAIEX benchmark lines.
  - **Weight chart**: visual breakdown of portfolio allocation by position.

**Supported markets**
- US equities (tickers like AAPL, MSFT) — prices from Twelve Data, denominated in USD.
- Taiwan equities (numeric stock codes like 2330, or Chinese company names like 台積電) — prices from FinMind/TWSE, denominated in TWD.
- USD/TWD exchange rate is used to normalize everything to TWD for the combined portfolio view.

**Data storage**
- All data is stored locally on the device. No cloud sync, no account system, no login required.
- Trade records persist across sessions in a local file.
- Quote and price history are cached locally with automatic refresh.

**This chat assistant**
- The user can open this chat sidebar from the floating button on the bottom-right corner of the page.
- The assistant can query the user's trades, holdings, daily portfolio values, benchmarks, and FX rates.
- It can answer questions like: performance comparison vs S&P 500, largest drawdown, holding weights, trade history for a specific ticker, etc.
</product>`

// --- Build System Prompt ---
// Constructs the full system prompt by appending all skill-specific prompts.
// With a single skill this is equivalent to the original monolithic prompt.
// When multiple skills exist, prepareStep can override this per-step.
export function buildSystemPrompt(activeSkills?: Skill[]): string {
  const skillsToInclude = activeSkills ?? skills
  const skillPrompts = skillsToInclude.map((s) => s.systemPrompt).join("\n\n")
  return `${BASE_SYSTEM_PROMPT}\n\n${skillPrompts}`
}

// --- Skill Lookup ---
// Find which skill owns a given tool name.
export function findSkillByToolName(toolName: string): Skill | undefined {
  return skills.find((skill) => toolName in skill.tools)
}
