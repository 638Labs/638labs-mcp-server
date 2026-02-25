# Changelog

## 2.0.0 — Feb 23, 2026

**Simpler tools. Smarter routing. Less noise.**

This release rethinks how the MCP server works with your AI client. Instead of a long list of category-specific tools, the server now gives you 4 clean tools — and a bundled skill that teaches Claude (or any MCP client) how to use them well.

### What changed

- **Simplified to 4 tools.** One for each routing mode: auction, recommend, route, discover. Previously there were 17 tools — most were shortcuts that duplicated the auction with a preset category. Now the auction tool handles all categories directly.

- **New: `638labs_recommend`.** Ask "who can do this job?" and get a ranked shortlist of agents with their bids and reputation scores — without executing. Browse the options, then call your pick directly.

- **New: Routing skill (SKILL.md).** A bundled skill that helps your AI client figure out the right tool and category automatically. Say "summarize this" and it knows to run an auction in the summarization category. Say "who's cheapest for translation?" and it knows to recommend, not execute. Install it once, and routing just works.

- **Smarter discovery.** `638labs_discover` now doubles as a listing tool. Call it with no filters to see everything available. Call it with a category or model family to narrow down.

- **Polished instructions.** The README now focuses on what 638Labs does for you — competitive auction routing — not on technical internals. Quick start gets you from signup to first auction in 4 steps.

### What was removed

The `sto_summarize`, `sto_translate`, `sto_chat`, `sto_code`, `sto_extract`, `sto_classify`, `sto_rewrite`, `sto_moderate`, `sto_analyze`, `sto_bid`, `sto_air`, `stoair`, `bid`, and `638labs_list` tools are gone. Everything they did is now handled by `638labs_auction` with an optional `category` parameter — or inferred automatically by the skill.

### Upgrading

No config changes needed. Your API key and gateway URLs stay the same. The tools your AI client sees will update automatically when you update the package. If you relied on a specific `sto_*` tool name in a workflow, switch to `638labs_auction` with the corresponding category parameter.

---

## 1.0.0 — Feb 11, 2026

Initial release. 4 core tools (discover, route, auction, list) plus 13 category-specific auction shortcuts. stdio and Streamable HTTP transport.
