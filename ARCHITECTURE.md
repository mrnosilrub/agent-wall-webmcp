# System Architecture

Agent Wall WebMCP establishes an agent-human collaboration platform built on a transport-neutral domain kernel, centered around in-page **WebMCP**, with a brief remote MCP compatibility bridge.

## Core Architectural Invariants: The Wall Laws

The system geometry and economics are governed by six strict invariants enforced across the domain kernel, contracts, and tool interfaces:

| Law | Specification | Formal Invariant |
| :--- | :--- | :--- |
| **1000×1000 Wall** | Fixed canvas dimensions | The grid spans $x \in [0, 999]$ and $y \in [0, 999]$, comprising exactly $1{,}000{,}000$ total Pixels. |
| **W×H Sellable Pixels** | Rectangular parcel partitioning | Any parcel claim is bounded by $(x, y, W, H)$ where $W \ge 1, H \ge 1$, $x + W \le 1000$, and $y + H \le 1000$. Total parcel area is $W \times H$ Pixels. |
| **One Pixel = 16×16 Art Texels** | Fine-grained rendering resolution | Each 1×1 sellable Pixel maps to an internal 16×16 raster texel matrix ($256$ art texels per Pixel). |
| **One Unified (16W)×(16H) Genesis Scene** | Immutable visual representation | A parcel's graphics form a single $(16W) \times (16H)$ raster scene governed by the Scene-v1 SHAPES protocol (`AWS1` magic, version 1, first-use palette indexing, deterministic geometry bytecode). The compiled bytecode produces hashes (`programHash`, `rgbHash`, `genesisLinkHash`) committed permanently upon acquisition. |
| **W×H USDC** | Deterministic flat pricing | The cost per Pixel is fixed at 1 USDC ($1{,}000{,}000$ micro-USDC). A $W \times H$ parcel costs exactly $W \times H$ USDC ($10^6 \times W \times H$ micro-USDC). |
| **One Deed** | Cryptographic parcel identity | Each parcel acquisition mints exactly one ERC-721 token (`AgentWallParcelDeed`). The token ID deterministically packs the geometry: $\text{tokenId} = (x \ll 48) \mid (y \ll 32) \mid (W \ll 16) \mid H$. |

## Layered System Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                          User & Agent Surface                          │
│                                                                        │
│   ┌──────────────────────────────────┐  ┌──────────────────────────┐   │
│   │    WebMCP (In-Page Centerpiece)  │  │  Remote MCP (Compat Coda)│   │
│   │  - In-browser tool provider      │  │  - Headless HTTP          │   │
│   │  - Direct DOM/Canvas projection  │  │  - CLI / IDE agent proxy │   │
│   │  - Ephemeral parcel staging      │  │  - Offline validation    │   │
│   └─────────────────┬────────────────┘  └─────────────┬────────────┘   │
└─────────────────────┼─────────────────────────────────┼────────────────┘
                      │                                 │
                      ▼                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Shared Canonical Tool Catalog                      │
│   survey_wall · preview_parcel · stage_parcel · inspect_receipt        │
│                                                                        │
│   - Unified Zod schemas                                                │
│   - Transport-neutral contract definitions                             │
│   - Identical error codes and validation rules                         │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Pure Domain Kernel                              │
│   src/domain/pricing.ts · src/domain/scene.ts · scene-v1-*             │
│                                                                        │
│   - Zero I/O, zero network, zero side-effects                          │
│   - Pure geometry & Scene-v1 SHAPES bytecode compiler                  │
│   - Deterministic flat pricing arithmetic                              │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Challenge Runtime & Fixture Infrastructure               │
│                                                                        │
│   - Base Sepolia (decimal chain ID 84532) deterministic fixture        │
│   - contracts/AgentWallParcelDeed.sol (ERC-721 + EIP-712 quotes)       │
│   - Deterministic test fixtures (no live broadcast, no external RPC)   │
│   - Zero fiat/card/Apple Pay dependencies                              │
└────────────────────────────────────────────────────────────────────────┘
```

## Centerpiece: In-Page WebMCP

The core design centers on executing the Model Context Protocol directly inside the client browser document (`WebMCP`). This architecture departs from conventional remote-only agent servers:

1. **Direct In-Page Agent Interface**: WebMCP exposes tools directly to browser-context LLMs, enabling assistive agents to navigate the wall coordinate space, calculate quotes, and validate scene artwork without network round-trips.
2. **Visual Projection**: Agent tool calls interact synchronously with the HTML5 canvas layer, rendering geometry previews directly into the active viewport.
3. **Transport Independence**: WebMCP executes without external socket connections or hosted proxies, delivering zero-latency tool dispatch in a sandboxed client environment.

## The Transient Presentation Boundary (`stage_parcel`)

The in-page tool `stage_parcel` provides interactive visual staging for agent-human pair composition:

- **Local Presentation Only**: Staging applies validated parcel geometry and Scene commitments to a transient in-memory candidate overlay and review panel.
- **Bound Facts Only**: The review panel is populated from the returned testnet identity, candidate digest, Scene digests, price, geometry, and expiry—not free-form agent text.
- **Local Lifecycle**: Staged state is manually cancellable, expires after five minutes, and is never persisted to `localStorage`, `sessionStorage`, IndexedDB, or server state. A page reload immediately restores the pristine canvas state.
- **Strict Execution Invariant**: `stage_parcel` cannot hold, reserve, order, request a signature, charge, pay, mint, or synthesize consent. Moving from staging to deed acquisition requires explicit, un-synthesized user confirmation through the smart contract claim workflow.

## Compatibility Coda: Remote MCP

Remote MCP is provided as a thin compatibility coda to ensure interoperability with external agent environments (such as terminal tools, IDE extensions, or autonomous CI test runners):

- It wraps the exact same canonical tool catalog and pure domain kernel.
- It exposes a standard MCP Streamable HTTP endpoint at `POST /mcp` without modifying schemas or validation logic.
- It maintains 1:1 behavioral and numeric parity with the in-page WebMCP interface.
- It is POST-only, fixed-window rate-limited per Cloudflare client identity, capped at 64 KiB while streaming request bodies, and still has no canonical write path.

## Challenge Runtime: Deterministic Fixture Mode

The challenge runtime executes entirely within a deterministic, self-contained fixture:

- **Target Chain**: Base Sepolia, decimal chain ID `84532`.
- **Testnet & Noncanonical**: All chain labels, receipts, and quotes are deterministic fixture data. There are no live on-chain submissions, mainnet interactions, or real-money transactions.
- **No Fiat Providers**: No fiat, credit card, Stripe, Crossmint, or Apple Pay provider or adapter ships in this repository. All costs are expressed and computed strictly in USDC terms ($1$ USDC per Pixel; $1{,}000{,}000$ micro-USDC per Pixel).
- **Network-Free Kernel**: Domain kernel modules (`src/domain/`) and browser-side WebMCP logic are strictly network-free, avoiding `fetch`, `WebSocket`, or external RPC calls.

## Exact Local Commands

The challenge implementation can be audited, built, and tested locally using these exact commands:

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
