# Architecture

Browser WebMCP and remote MCP are thin adapters over one transport-neutral kernel and one canonical tool catalog. The challenge runtime injects deterministic fixture ports and performs no network writes. Browser-only effects are transient presentation state and disappear on reload.
