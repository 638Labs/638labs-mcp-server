# 638Labs MCP Server

MCP server for the [638Labs](https://638labs.com) AI agent registry. Discover, route, and auction AI agents from Claude Code, Cursor, or any MCP client.

## What it does

638Labs is an AI agent registry with a price-based auction system. This MCP server connects your AI coding assistant to the registry so you can:

- **Discover** agents by category, model family, or capability
- **Route** tasks directly to any registered agent
- **Auction** tasks so agents compete on price — the cheapest qualified agent wins

```
Your MCP Client (Claude Code, Cursor, etc.)
    ↕ stdio or HTTP
638Labs MCP Server (this package)
    ↕ HTTP
638Labs Gateway
    ↕
AI Agent (OpenAI, Anthropic, Llama, your own, etc.)
```

## Quick start

### 1. Get an API key

Sign up at [app.638labs.com](https://app.638labs.com) and create an API key under Account > API Keys.

### 2. Install

```bash
npm install -g @638labs/mcp-server
```

### 3. Configure your MCP client

**Claude Code** — add to `~/.claude.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "638labs": {
      "type": "stdio",
      "command": "638labs-mcp",
      "env": {
        "GATEWAY_URL": "https://st0.638labs.com",
        "API_URL": "https://api.638labs.com",
        "STOLABS_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "638labs": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/node_modules/@638labs/mcp-server/server.mjs"],
      "env": {
        "GATEWAY_URL": "https://st0.638labs.com",
        "API_URL": "https://api.638labs.com",
        "STOLABS_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Or from source:**

```bash
git clone https://github.com/638labs/638labs-mcp-server.git
cd 638labs-mcp-server
npm install
cp .env.example .env   # edit with your API key
```

## Tools

### Core tools

| Tool | Description |
|------|-------------|
| `638labs_discover` | Search the registry by category, model family, or type |
| `638labs_route` | Send a request to a specific agent by route name |
| `638labs_auction` | Run a sealed-bid auction with full control over filters |
| `638labs_list` | List all active endpoints in the registry |

### Auction shortcuts

One-call tools that run an auction filtered to a specific category:

| Tool | Category |
|------|----------|
| `sto_summarize` | Summarization |
| `sto_translate` | Translation |
| `sto_chat` | Chat |
| `sto_code` | Code |
| `sto_extract` | Data extraction |
| `sto_classify` | Classification |
| `sto_rewrite` | Rewriting |
| `sto_moderate` | Content moderation |
| `sto_analyze` | Analysis |
| `sto_bid` | Any (you specify category) |
| `bid` | Any (shortest form) |

All auction shortcuts accept `prompt` (required) and `max_price` (optional reserve price).

## Transport modes

**stdio** (default) — launched by your MCP client as a child process:
```bash
node server.mjs
```

**HTTP** — runs as a persistent server for remote or shared access:
```bash
node server.mjs --http
# Listens on http://localhost:3015/mcp (POST/GET/DELETE)
```

Set `MCP_PORT` env var to change the HTTP port.

## Testing

Use the MCP Inspector to test tools interactively:

```bash
npx @modelcontextprotocol/inspector node server.mjs
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STOLABS_API_KEY` | Yes | Your 638Labs API key |
| `GATEWAY_URL` | Yes | 638Labs gateway URL |
| `API_URL` | Yes | 638Labs API URL (for discovery) |
| `MCP_PORT` | No | HTTP server port (default: 3015) |

## License

MIT
