# Tool reference — dreamdex-event-contracts (bettor tools)

Exposed by `agents/proxy-servers/shared/mcpServer.ts` in the `agentic-prediction-market` repo. Names below
are the bare tool names that server registers; OpenClaw prefixes each as
`dreamdex-event-contracts__<name>` as of this writing — check your installed version's actual tool
list if calls fail with "tool not found."

### `list_markets`

Input: `{ status?: "LISTED" | "TRADING" | "LOCKED" | "RESOLVED" | "VOIDED" }` (omit for all)
Output: `{ markets: MarketSummary[] }`

### `get_market`

Input: `{ marketId: string }`
Output: `{ market: MarketSummary }`

### `get_order_book`

Input: `{ marketId: string, depth?: number }` (default depth `5`)
Output: `{ marketId, bids: [{ price, quantity }], asks: [{ price, quantity }], updatedAt }`

### `place_order`

Input:

```json
{
  "marketId": "string",
  "side": "BUY_YES | SELL_YES | BUY_NO | SELL_NO",
  "price": "number, 0-1 (probability)",
  "quantity": "number, outcome shares",
  "orderType": "LIMIT | MARKET | POST_ONLY | FILL_OR_KILL (optional, default LIMIT)"
}
```

Output: `{ orderId?, filledQuantity, avgFillPrice?, txHash?, payment?, marketQuestion?, receipt }` —
`BUY_YES`/`BUY_NO` from an agent with its own configured wallet also returns a `payment` object
(`{ feeAmount, txHash }`) from the x402 fee flow (see [setup.md](setup.md)). `receipt` is a
ready-formatted plain-text order-execution receipt — market title, side, fill price/quantity, fee,
and Somnia block-explorer links for the order (and fee) transaction hashes — built server-side
(`agents/proxy-servers/shared/receipt.ts`) so it's identical across the CLI, Open WebUI chat, and this MCP
path. Relay it verbatim when reporting a fill back to the user — see **Reporting a fill back to the
user** in [../SKILL.md](../SKILL.md).

### `mint_set`

Input: `{ marketId: string, amount: number }` — deposits `amount` collateral, mints `amount` YES
shares + `amount` NO shares (a complete set).
Output: `{ txHash? }`

### `get_positions`

Input: none
Output: `{ positions: [{ marketId, yesShares, noShares }] }`

### `redeem`

Input: `{ marketId: string, outcome: "YES" | "NO" }`
Output: `{ payout: number }` — `0` if you hold none of that outcome; not an error.

### `faucet`

Input: `{ amount?: number }` (max `10000`; omit for the full cap) — Somnia testnet only.
Output: `{ amount, txHash?, walletAddress? }`

### `get_erc8004_status`

Input: none
Output: `{ registered: boolean, erc8004AgentId?: string, walletAddress?: string }`

A live on-chain read — not this conversation's own memory of past `register_erc8004_identity`
attempts, which can be stale (e.g. registration succeeded afterward via another session or the
CLI). Call this before `register_erc8004_identity` to check first.

### `register_erc8004_identity`

Input: none
Output: `{ erc8004AgentId, txHash, agentURI, walletAddress }`

Always mints a *new* Agent-ID — no check for an existing one, so call `get_erc8004_status` first to
avoid a redundant second identity. Call once, before your first buy. Requires this agent to have
its own wallet configured (see
[setup.md](setup.md)) — errors otherwise.

---

## `MarketSummary` shape

Returned inside `list_markets` and `get_market`:

```json
{
  "id": "string",
  "symbol": "string",
  "question": "string",
  "category": "string",
  "status": "LISTED | TRADING | LOCKED | RESOLVED | VOIDED",
  "createdAt": "unix seconds",
  "expiresAt": "unix seconds",
  "yesPrice": "number, 0-1",
  "noPrice": "number, 0-1",
  "volume": "number",
  "liquidity": "number",
  "createdBy": "string (optional)",
  "resolvedOutcome": "YES | NO | VOID (optional, only once settled)"
}
```
