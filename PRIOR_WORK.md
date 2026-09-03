# Prior Work Disclosure

This document provides judges and reviewers with an unambiguous attribution boundary, clearly distinguishing the pre-existing Agent Wall foundations from the original work developed during the challenge period.

## Attribution Overview

Agent Wall predates this challenge as an on-chain canvas concept. However, this challenge projection transforms Agent Wall by establishing **WebMCP as the centerpiece**: embedding the Model Context Protocol directly inside the browser client document, introducing real-time agent-human visual collaboration, and establishing a unified transport-neutral tool catalog.

## Pre-Existing Work (Prior to Challenge Period)

The following core components, protocols, and contracts were created prior to the challenge period:

1. **The Wall Laws and Economic Model**:
   - The foundational 1000×1000 Wall coordinate space (1,000,000 Pixels).
   - The partition of space into $W \times H$ sellable Pixels.
   - The texel resolution invariant: 1 Pixel = 16×16 Art Texels.
   - The flat pricing schedule: 1 USDC per Pixel ($W \times H$ USDC per parcel).
2. **The Scene-v1 SHAPES Specification**:
   - The binary container format (`AWS1` magic, version 1).
   - First-use palette indexing and opcode definitions (`BG`, `RECT`, `CIRCLE`, `TRI`, `CHECKER`).
   - The deterministic derivation of a single, immutable $(16W) \times (16H)$ Genesis Scene.
3. **The Smart Contract Architecture**:
   - `AgentWallParcelDeed.sol`: An ERC-721 implementation encoding $(x, y, W, H)$ directly into the token ID.
   - EIP-712 structured quote verification and cryptographic commitment of genesis scene hashes (`programHash`, `rgbHash`, `genesisLinkHash`).
4. **Legacy Remote MCP Server**:
   - An earlier remote MCP product route designed for backend/CLI agents communicating over remote server transports.
5. **Read-Only Wall Viewer**:
   - Static wall inspection and occupancy checking.

## Challenge-Period Contributions (Original Challenge Work)

The following capabilities, systems, and adaptations were developed specifically during the challenge period:

1. **In-Page WebMCP Architecture (Centerpiece)**:
   - Implementation of an in-page Model Context Protocol server executing directly in the client browser runtime.
   - Elimination of external proxy layers for browser-embedded agents, allowing local AI agents to query canvas state, compute quotes, and validate scenes at zero latency.
2. **Shared Transport-Neutral Tool Catalog**:
   - Creation of one canonical four-tool catalog with unified Zod-derived JSON Schemas (`survey_wall`, `preview_parcel`, `stage_parcel`, `inspect_receipt`).
   - Establishing strict semantic and functional parity between in-page WebMCP and remote MCP, with remote MCP positioned as a thin compatibility coda.
3. **In-Browser Agent-Human Collaboration Flow**:
   - Development of the `stage_parcel` tool enabling live visual preview rendering directly on the HTML5 canvas.
   - Strict architectural isolation of staging: transient in-memory presentation only, cleared on reload, unable to hold, reserve, order, request signatures, charge, pay, mint, or synthesize user consent.
4. **Fixture-Safe Public Challenge Projection**:
   - Creation of an isolated, browser-network-free public projection using deterministic fixture data labeled Base Sepolia (decimal chain ID `84532`).
   - Clean decoupling from private production infrastructure, ensuring zero fiat/card/Apple Pay provider or adapter ships in this repository.
   - Automated repository hygiene enforcement via `npm run scrub`.

## Separation Matrix

| Component | Provenance | Role in Challenge |
| :--- | :--- | :--- |
| **1000×1000 Grid & Wall Laws** | Pre-Existing | Fundamental geometric and economic rules ($W \times H$ Pixels, $16 \times 16$ texels/Pixel, $W \times H$ USDC) |
| **Scene-v1 SHAPES Protocol** | Pre-Existing | Canonical binary graphics format and $(16W) \times (16H)$ genesis scene compilation |
| **AgentWallParcelDeed.sol** | Pre-Existing | ERC-721 Deed token contract with EIP-712 quote verification and genesis record commitment |
| **Remote MCP Route** | Pre-Existing | Prior product foundation; the challenge adds a fixture-safe Streamable HTTP adapter over the new shared catalog |
| **In-Page WebMCP Server** | **Challenge Period** | **Centerpiece**: In-browser tool provider for real-time agent pair composition |
| **Shared Tool Catalog & Schemas** | **Challenge Period** | Transport-neutral tool definitions guaranteeing exact WebMCP / remote MCP parity |
| **Transient Staging (`stage_parcel`)** | **Challenge Period** | Ephemeral, reload-cleared local presentation overlay with strict zero-custody boundaries |
| **Deterministic Fixture Harness** | **Challenge Period** | Base Sepolia (84532) testnet-labeled fixture with no browser-side network dependencies |
| **Hygiene & Scrub Suite** | **Challenge Period** | Automated verification scripts (`npm run scrub`) ensuring zero secret or infrastructure leakage |

## Verification Commands

Audit and verify the challenge build locally with:

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
