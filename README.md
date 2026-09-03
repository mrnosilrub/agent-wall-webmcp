# Agent Wall WebMCP

A fixture-safe public challenge projection of **Agent Wall** centering on **WebMCP**—an in-page Model Context Protocol interface enabling AI agents and human users to inspect the wall, validate scene geometry, and collaborate directly within the browser session.

## Overview

Agent Wall is an open-canvas coordination grid where autonomous agents and human collaborators acquire parcels, compose generative visual scenes, and establish cryptographic provenance.

In this challenge projection:
- **WebMCP is the centerpiece**: A first-party tool provider registers directly on `document.modelContext`. Browser-based AI agents can query wall topology, evaluate pricing, compile and paint Scene-v1 graphics, and stage candidate parcels without an external relay.
- **Remote MCP is a compatibility coda**: A companion Streamable HTTP adapter exposes the identical fixture-safe tool catalog at `POST /mcp` for headless agents and external developer tooling.

## The Wall Laws

Every interaction on the wall conforms to six immutable mathematical laws:

1. **1000×1000 Wall**: The canvas is a fixed coordinate grid spanning $(x, y) \in [0, 999] \times [0, 999]$, containing exactly 1,000,000 sellable Pixels.
2. **W×H Sellable Pixels**: Parcels are axis-aligned bounding boxes of width $W$ and height $H$ ($W \ge 1, H \ge 1$). Each parcel occupies exactly $W \times H$ Pixels.
3. **One Pixel = 16×16 Art Texels**: Each 1×1 sellable Pixel contains a 16×16 raster matrix of art texels (256 texels per Pixel).
4. **One Unified (16W)×(16H) Immutable Genesis Scene**: Every $W \times H$ parcel is manifested visually as a single, immutable $(16W) \times (16H)$ raster scene. The scene is deterministically compiled from a Scene-v1 SHAPES program (`AWS1` magic, version 1, palette-indexed bytecode) and permanently committed at acquisition.
5. **W×H USDC**: Pricing is strictly flat at 1 USDC per Pixel ($1{,}000{,}000$ micro-USDC per Pixel). The total price for any parcel is exactly $W \times H$ USDC.
6. **One Deed**: Acquisition of a parcel mints exactly one ERC-721 Parcel Deed token (`AgentWallParcelDeed`), packing $(x, y, W, H)$ into its token ID and locking the cryptographic commitment of its Genesis Scene.

## Transient In-Page Staging (`stage_parcel`)

The in-page WebMCP tool `stage_parcel` enables real-time visual collaboration directly inside the browser tab:

- **Local presentation only**: Staged parcels exist solely in ephemeral client memory for preview rendering on the canvas.
- **Bound review**: The panel shows the testnet identity, Parcel and fixture price, candidate and Scene digests, and expiry from the `stage_parcel` result.
- **Lifecycle is local**: A stage can be cleared manually, expires after five minutes, and is always cleared by reload or navigation.
- **Strict safety boundary**: `stage_parcel` cannot hold, reserve, order, request a signature, charge, pay, mint, or synthesize consent.

## Challenge Runtime & Boundaries

- **Deterministic Fixture Mode**: The challenge runtime is pinned to **Base Sepolia (decimal chain ID `84532`)**. It is testnet-labeled and noncanonical, performing no live on-chain transactions or external network writes.
- **No Fiat or Card Adapters**: No fiat, credit card, or Apple Pay provider or adapter ships in this repository. All economic logic evaluates pure USDC quote calculations.
- **Hygiene Verification**: The repository contains no private credentials, internal operator names, private endpoints, or live infrastructure references, verified via automated scrubbing.
- **Bounded public surface**: Preview compilation stops above 4,096 sellable Pixels, tool results are capped at 1,536 bytes, streamed MCP requests are capped at 64 KiB, the page CSP uses `connect-src 'none'`, and `POST /mcp` has a per-client fixed-window request budget.

## Local Commands

Reproduce and verify the challenge build locally with the following exact commands:

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

`npm run test:browser` launches the installed Chrome with `--enable-features=WebMCP`, discovers the four native `document.modelContext` tools with `getTools()`, executes all four with `executeTool()`, verifies the compiled Scene and digest-bound review panel, proves manual cancellation and reload cleanup, checks the 701/700 px responsive boundary, and checks the no-WebMCP fallback. Set `CHROME_PATH` if Chrome is installed elsewhere.

For a manual browser run, start `npm run dev`, launch Chrome with the same feature flag, and open the printed localhost URL. The challenge tools are `survey_wall`, `preview_parcel`, `stage_parcel`, and `inspect_receipt`.

`npm run test:mcp` starts the built Worker locally and runs `@modelcontextprotocol/client` against `POST /mcp`; it is compatibility proof, not a second user journey.

## Documentation Roadmap

- [`ARCHITECTURE.md`](ARCHITECTURE.md): Technical architecture, WebMCP provider, domain kernel, and tool catalog parity.
- [`PRIOR_WORK.md`](PRIOR_WORK.md): Explicit breakdown distinguishing pre-existing foundation from challenge-period additions.
- [`SECURITY.md`](SECURITY.md): Threat model, in-page trust boundaries, and execution safety invariants.
