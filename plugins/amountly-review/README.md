# Amountly Review — local development plugin

Read-only tools and an interactive MCP App for unpaid invoices, upcoming bills, weekly overviews, period findings and supporting records.

From the Amountly repository root:

```sh
npm ci
AMOUNTLY_REVIEW_MODE=synthetic npm run dev -- --hostname localhost --port 4180
```

The local package connects to `http://localhost:4180/api/mcp`. It contains only synthetic data unless the server configuration is deliberately changed. No OpenAI API key is needed for these tools.

- Web review: `http://localhost:4180/review-preview`
- MCP panel bridge harness: `http://localhost:4180/api/financial-review/panel-preview`
- Checks: `npm run test:financial-review`
- Synthetic follow-through demo: `node scripts/review-event-demo.cjs --enable`

This folder has not been published or registered with ChatGPT. A real ChatGPT install needs developer-mode MCP registration with a reachable development endpoint. Private account data additionally needs a reviewed OAuth integration; this package does not invent a remote plugin ID or distribute bearer tokens.

See [implementation and configuration](../../docs/FINANCIAL_REVIEW_IMPLEMENTATION.md) for the Agents API data-residency/retention restrictions, exact access failure, security boundaries, tests and remaining work.
