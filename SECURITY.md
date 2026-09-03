# Security Policy & Execution Boundaries

This repository implements a fixture-safe, deterministic, testnet-labeled, and noncanonical challenge projection of Agent Wall WebMCP. The threat model and architectural security boundaries are defined below.

## Trust Boundaries & Execution Sandboxing

### 1. In-Page WebMCP Sandbox
WebMCP is the centerpiece of the system, running directly within the client document. It operates under strict browser security policies:
- **Zero Background Network Writes**: Browser WebMCP tools communicate synchronously with local in-memory data structures and the canvas. They execute no unauthorized background network requests (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, or `sendBeacon`).
- **No Custodial Access**: WebMCP does not hold, access, or manage user private keys, wallet signers, or credential tokens.

### 2. Transient Presentation Invariant (`stage_parcel`)
The in-page tool `stage_parcel` is constrained by strict execution boundaries:
- **Presentation Only**: It provides local visual feedback by overlaying proposed parcel geometry and Scene-v1 artwork onto the canvas.
- **Reload Clears It**: Staged state lives strictly in volatile memory. A browser page reload immediately clears the staged state.
- **Zero Transactional Authority**: `stage_parcel` cannot hold, reserve, order, request a signature, charge, pay, mint, or synthesize consent. All final on-chain actions require explicit, un-synthesized human confirmation through an external wallet interface.

### 3. Remote MCP Compatibility Boundary
Remote MCP exists as a thin compatibility coda providing headless access to the exact same tool catalog and domain kernel. It enforces the same read-only and validation invariants as WebMCP without granting administrative privileges.

- `GET /mcp` and other methods fail with `405`; only Streamable HTTP `POST /mcp` is accepted.
- A bounded, per-client fixed-window budget limits requests before MCP dispatch.
- Streamed MCP request bodies are stopped above 64 KiB before SDK parsing.
- Preview and stage compilation fail before raster allocation above 4,096 sellable Pixels; every structured tool result is capped at 1,536 bytes.
- Asset responses use `connect-src 'none'`, so the in-page provider cannot silently call the compatibility endpoint.

## Economic & Contract Invariants: The Wall Laws

All state transitions must conform to the immutable Wall laws enforced by the domain kernel and `AgentWallParcelDeed.sol`:
- **1000×1000 Wall**: Coordinate bounds $x \in [0, 999], y \in [0, 999]$; maximum 1,000,000 Pixels.
- **W×H Sellable Pixels**: Axis-aligned rectangles where $W \ge 1, H \ge 1$, $x + W \le 1000$, and $y + H \le 1000$.
- **One Pixel = 16×16 Art Texels**: 256 texels per Pixel; preventing fractional or out-of-bounds rendering.
- **One Unified (16W)×(16H) Immutable Genesis Scene**: Canonical Scene-v1 bytecode commitment locked at mint time via cryptographic hash (`programHash`, `rgbHash`, `genesisLinkHash`).
- **W×H USDC**: Rigid pricing of exactly 1 USDC per Pixel ($1{,}000{,}000$ micro-USDC per Pixel).
- **One Deed**: Exactly one ERC-721 token per parcel claim, encoding $(x, y, W, H)$ into its token ID.

## Challenge Runtime Context

- **Target Network**: Base Sepolia, decimal chain ID `84532`.
- **Testnet & Noncanonical**: All challenge runtime interactions execute against deterministic fixture data. No live funds, real USDC, or mainnet assets are at risk.
- **No Fiat or Card Adapters**: No fiat, credit card, Stripe, Crossmint, or Apple Pay provider or adapter ships in this repository. All pricing logic strictly reflects on-chain USDC calculations.

## Repository Hygiene & Leak Prevention

Repository contents are audited against strict hygiene rules enforced by `npm run scrub`:
- **No Credential Fields**: Forbidden patterns such as credential keys, database identifiers, or account IDs are prohibited.
- **No Private Infrastructure**: No private domain origins, RPC endpoints, internal operator names, or private overlay paths are permitted in the public projection.
- **Allowlisted Hashes**: Core contracts and domain files are validated against fixed SHA-256 hashes in `projection-manifest.json`.

## Local Verification Commands

Audit, verify, and test the security and hygiene boundaries locally using these exact commands:

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run test:browser
npm run test:mcp
npm run scrub
npm run check
```

## Vulnerability Reporting

If you discover a security issue or unexpected behavior in the domain kernel or contracts, please report it privately to the repository maintainers rather than opening a public issue.
