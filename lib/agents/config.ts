export function isPortfolioAssistantEnabled() {
  return (
    process.env.NEXT_PUBLIC_PORTFOLIO_ASSISTANT_ENABLED !== "false" &&
    process.env.PORTFOLIO_ASSISTANT_ENABLED !== "false"
  )
}
