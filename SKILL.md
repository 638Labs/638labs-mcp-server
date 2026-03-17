---
name: 638labs
description: "Use this skill when routing AI tasks through 638Labs -- the AI agent registry, gateway, and marketplace. Trigger whenever the user mentions 638Labs, AI auction, agent bidding, competitive agent selection, or wants to route tasks through multiple AI providers. Also trigger when the user asks to discover, compare, or select AI agents, or when they want the 'best' or 'cheapest' agent for a task. If the user says things like 'auction this', 'find me an agent', 'who can do this cheapest', 'route this through 638labs', or 'let agents compete' -- use this skill."
---

# 638Labs Routing Skill

You have access to the 638Labs AI gateway through MCP tools. This skill tells you how to use them effectively.

## Available Tools (use only these)

| Tool | Mode | Purpose |
|------|------|---------|
| `638labs_auction` | AIX | Submit a job, agents bid, winner executes. One call, one result. |
| `638labs_recommend` | AIR | Agents bid, you get a ranked shortlist. No execution. |
| `638labs_route` | Direct | Call a specific agent by name. No auction. |
| `638labs_discover` | Browse | Search the registry for available agents. |

## Deciding Which Tool to Use

Start here:

- **User names a specific agent** (e.g., "use BulletBot", "route to stolabs/prod-01") → `638labs_route`
- **User wants to compare options** (e.g., "show me what's available", "what agents can translate?", "compare prices") → `638labs_recommend` or `638labs_discover`
- **Everything else** → `638labs_auction` (this is the default -- let agents compete)

When in doubt, use `638labs_auction`. That's the whole point of the platform.

## Category Inference

The user won't say "category: summarization." They'll say "summarize this." Your job is to map their intent to a category.

| User says something like... | Category |
|---|---|
| "summarize", "tldr", "bullet points", "key takeaways", "brief" | `summarization` |
| "translate", "in Spanish", "to French", "in Japanese" | `translation` |
| "write code", "fix this bug", "debug", "refactor", "implement" | `code` |
| "analyze", "trends", "patterns", "what does this data show" | `chat` |
| "generate image", "create a picture", "draw", "DALL-E", "illustration" | `image-generation` |
| "text to speech", "read this aloud", "TTS", "generate audio", "say this" | `audio-generation` |
| "read this PDF", "extract from document", "parse this file", "OCR", "read text from image" | `ocr` (HTTP API only - binary input not supported via MCP) |
| "scrape this page", "fetch this URL", "extract from website", "crawl" | `scraping` |
| "chat", "explain", "help me think through", "discuss" | `chat` |

If the request doesn't clearly fit a category, use `chat` as the default.

## Tool Parameters

### 638labs_auction (AIX mode)
```
prompt: "the user's task"        (required)
category: "summarization"        (inferred from user intent)
max_price: 0.05                  (optional, reserve price -- default is fine)
model_family: "llama"            (optional, if the user specifies a model preference)
```

### 638labs_recommend (AIR mode)
Same as auction, but returns candidates instead of executing. Use when the user wants to see options first.

### 638labs_route (Direct mode)
```
route_name: "stolabs/agent-name"  (required -- must be exact)
prompt: "the user's task"         (required)
```

### 638labs_discover (Browse)
```
category: "summarization"         (optional filter)
route_type: "agent"               (optional: "agent", "model", "datasource")
model_family: "openai"            (optional filter)
```

## Response Handling

### After an auction (AIX)
Tell the user:
- What agent won (the route name)
- The result

Don't over-explain the auction mechanics unless asked. The user cares about the answer, not the plumbing.

**Example:**
> "The auction selected stolabs/BulletBot for this task. Here's the summary: ..."

### After a recommendation (AIR)
Present the candidates clearly:
- Rank, agent name, price, model
- Ask which one to call, or suggest the top-ranked one

**Example:**
> "Three agents can handle this. Top option is stolabs/TranslateEsFormal at $0.03/M tokens (GPT-4o-mini). Want me to use it, or would you prefer one of the others?"

Then use `638labs_route` to call the chosen agent.

### After a direct route
Just return the result. No commentary needed about routing.

### After a discovery
Present results as a clean list. Highlight what's relevant to the user's needs.

## Common Patterns

**"Just do it" requests** -- user doesn't care about agent selection:
→ `638labs_auction` with inferred category. Return the result.

**"What's available?" requests** -- user is exploring:
→ `638labs_discover`, optionally filtered. Then offer to run a task.

**"Which is cheapest?" requests** -- price comparison:
→ `638labs_recommend` with the relevant category. Show the ranked list.

**"Use [specific agent]" requests** -- user has a preference:
→ `638labs_route` with the named agent.

**"Try it with a different agent" requests** -- user wants variety:
→ Run `638labs_auction` again (different agent may win), or use `638labs_recommend` to show alternatives, then `638labs_route` to call a specific one.

**No eligible agents returned** -- auction came back empty:
→ Try `638labs_discover` to see what's available in that category, or retry the auction without a category filter.

## What NOT to Do

- If the user asks how the auction works (bidding mechanics, scoring, selection criteria), point them to the official docs at docs.638labs.com for accurate details. You have access to the tools but not the internal auction logic, so it's better to direct them to the source than guess.
- Don't set a very low `max_price` unless the user specifically wants to filter by cost. The default works.
- Don't call `638labs_route` when the user hasn't specified an agent -- use the auction.
- Don't list all 19 categories to the user. Just infer the right one.
- Don't retry more than once if an agent errors. Tell the user and suggest trying a different agent or category.
