#!/usr/bin/env node

/*
  638Labs MCP Server — The Battledome

  4 tools. One auction. N agents. Best agent wins.

  Tools:
    638labs_auction   — AIX mode. Submit a job, agents compete, winner executes.
    638labs_recommend — AIR mode. Get ranked candidates, no execution.
    638labs_route     — Direct mode. Call a specific agent by name.
    638labs_discover  — Browse the registry. No filters = list all.

  Two transport modes:
    stdio (default) — launched by Claude Code / MCP Inspector as a child process
    http            — runs as a persistent HTTP service for remote clients (Streamable HTTP)

  Usage:
    node server.mjs          # stdio mode (local, launched by MCP client)
    node server.mjs --http   # HTTP mode (production, persistent server)

  Architecture:
    MCP Client (Claude Code, Codex, Cursor, n8n, etc.)
      ↕ (stdio local or Streamable HTTP remote)
    This server (e2)
      ↕ (HTTP)
    e0 Gateway → Auction Engine → Target AI Endpoint
*/

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { z } from 'zod';
import * as registry from './registry.mjs';
import * as gateway from './gateway.mjs';

const MODE = process.argv.includes('--http') ? 'http' : 'stdio';
const HTTP_PORT = process.env.MCP_PORT || 3015;

const server = new McpServer({
  name: '638labs',
  version: '2.0.0',
});

// ========================
// Tool 1: Auction (AIX)
// ========================
server.tool(
  '638labs_auction',
  'Run an AI agent auction. Agents compete in a real-time sealed-bid auction — the best agent wins and executes your task. Submit any prompt: summarize, translate, code, chat, analyze, classify, extract, rewrite, moderate — the auction finds the right agent and the right price.',
  {
    prompt: z.string().describe('The prompt or task to send to the auction'),
    category: z.string().optional().describe('Filter bidding agents by category (e.g., "chat", "summarization", "code", "translation", "analysis", "classification", "extraction", "rewriting", "moderation")'),
    max_price: z.number().optional().describe('Maximum price you are willing to pay (reserve price)'),
    model_family: z.string().optional().describe('Filter by model family (e.g., "gpt", "claude", "cohere", "llama")'),
    model_flavour: z.string().optional().describe('Filter by specific model (e.g., "gpt-4o", "command-r"). Use "any" to allow all.'),
  },
  async ({ prompt, category, max_price, model_family, model_flavour }) => {
    try {
      const payload = {
        model: 'default',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        stoPayload: {
          stoAuction: {
            core: {
              ...(category && { category }),
              auction_mode: 'aix',
              ...(max_price && { reserve_price: max_price }),
              price_unit: '1million_token',
            },
            constraints: {
              ...(model_family && { model_family }),
              ...(model_flavour && { model_flavour }),
            },
            preferences: {},
          },
        },
      };

      const result = await gateway.auctionRequest(payload);

      const winner = result?.message?.endpoint;
      const responseText = result?.message?.result?.choices?.[0]?.message?.content
        || result?.message?.result
        || JSON.stringify(result);

      const auctionInfo = winner
        ? `Auction winner: ${winner.route_name} (bid: ${winner.bid_price || 'N/A'})`
        : 'Auction completed';

      return {
        content: [{
          type: 'text',
          text: `[${auctionInfo}]\n\n${responseText}`
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Auction error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ========================
// Tool 2: Recommend (AIR)
// ========================
server.tool(
  '638labs_recommend',
  'Get ranked AI agent recommendations without executing. Agents compete in a sealed-bid auction, and you get back the top candidates with their bids, reputation scores, and capabilities. Use this to compare options before committing, or to let the user pick their preferred agent.',
  {
    prompt: z.string().describe('The task description to match agents against'),
    category: z.string().optional().describe('Filter by category (e.g., "chat", "summarization", "code", "translation")'),
    top_k: z.number().optional().describe('Number of candidates to return (default: 3)'),
    max_price: z.number().optional().describe('Maximum price filter (reserve price)'),
    model_family: z.string().optional().describe('Filter by model family (e.g., "gpt", "claude", "llama")'),
  },
  async ({ prompt, category, top_k, max_price, model_family }) => {
    try {
      const payload = {
        model: 'default',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        stoPayload: {
          stoAuction: {
            core: {
              ...(category && { category }),
              auction_mode: 'air',
              ...(top_k && { top_k }),
              ...(max_price && { reserve_price: max_price }),
              price_unit: '1million_token',
            },
            constraints: {
              ...(model_family && { model_family }),
            },
            preferences: {},
          },
        },
      };

      const result = await gateway.auctionRequest(payload);

      const candidates = result?.message?.candidates || result?.message?.results || [];

      if (Array.isArray(candidates) && candidates.length > 0) {
        const list = candidates.map((c, i) => {
          const name = c.route_name || c.name || `Agent ${i + 1}`;
          const bid = c.bid_price != null ? `$${c.bid_price}` : 'N/A';
          const rep = c.reputation_score != null ? c.reputation_score.toFixed(2) : 'unranked';
          const cat = c.category || 'unknown';
          return `${i + 1}. **${name}** — bid: ${bid}, reputation: ${rep}, category: ${cat}`;
        }).join('\n');

        return {
          content: [{
            type: 'text',
            text: `Found ${candidates.length} candidate(s):\n\n${list}\n\nUse 638labs_route with a route_name to call your preferred agent.`
          }]
        };
      }

      // Fallback: return raw result if structure is different
      return {
        content: [{
          type: 'text',
          text: `Recommendations:\n\n${JSON.stringify(result, null, 2)}`
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Recommend error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ========================
// Tool 3: Route (Direct)
// ========================
server.tool(
  '638labs_route',
  'Send a request directly to a specific AI agent by name. No auction, no competition — just a straight call through the 638Labs gateway. Use this when you already know which agent you want (e.g., from a previous recommendation or discovery).',
  {
    route_name: z.string().describe('The agent route name (e.g., "stolabs/prod-01" or "your-org/agent-v2")'),
    prompt: z.string().describe('The prompt or message to send to the agent'),
    model: z.string().optional().describe('Optional model override for the target endpoint'),
    provider_api_key: z.string().optional().describe('Optional API key for external providers (OpenAI, Cohere, etc.)'),
  },
  async ({ route_name, prompt, model, provider_api_key }) => {
    try {
      const payload = {
        model: model || 'default',
        messages: [{ role: 'user', content: prompt }],
      };

      const result = await gateway.routeRequest(route_name, payload, provider_api_key);

      const responseText = result?.choices?.[0]?.message?.content
        || result?.message
        || JSON.stringify(result);

      return {
        content: [{
          type: 'text',
          text: `[via ${route_name}]\n\n${responseText}`
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error routing to ${route_name}: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ========================
// Tool 4: Discover
// ========================
server.tool(
  '638labs_discover',
  'Browse the 638Labs AI agent registry. Search by category, model family, or capability — or call with no filters to list everything available. Use this to see what agents exist before running an auction or routing directly.',
  {
    category: z.string().optional().describe('Filter by category (e.g., "chat", "summarization", "code", "data", "translation")'),
    model_family: z.string().optional().describe('Filter by model family (e.g., "gpt", "claude", "cohere", "llama")'),
    route_type: z.string().optional().describe('Filter by type: "model", "agent", or "datasource"'),
    query: z.string().optional().describe('Free text search term to match against agent names'),
  },
  async ({ category, model_family, route_type, query }) => {
    try {
      const hasFilters = category || model_family || route_type || query;

      // No filters = list all active endpoints
      const endpoints = hasFilters
        ? await registry.searchEndpoints({ category, model_family, route_type, query })
        : await registry.listEndpoints();

      if (endpoints.length === 0) {
        return {
          content: [{
            type: 'text',
            text: hasFilters
              ? 'No matching agents found. Try broader filters or call with no parameters to see everything.'
              : 'No active endpoints found in the registry.'
          }]
        };
      }

      const results = endpoints.map(ep => ({
        name: ep.name,
        route_name: ep.route_name,
        route_type: ep.route_type,
        category: ep.agent?.category,
        model_family: ep.agent?.model_family,
        model_flavour: ep.agent?.model_flavour,
        availability: ep.agent?.availability,
        online: ep.agent?.online,
        quality_score: ep.agent?.quality_score,
        auction_enabled: ep.auction?.enabled,
        bid_strategy: ep.auction?.bid_strategy,
        price_range: ep.auction?.enabled
          ? `${ep.auction.price_min}-${ep.auction.price_max} ${ep.auction.currency}/${ep.auction.unit}`
          : 'N/A',
      }));

      return {
        content: [{
          type: 'text',
          text: `638Labs Registry — ${results.length} agent(s):\n\n${JSON.stringify(results, null, 2)}`
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error searching registry: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ========================
// Start
// ========================
async function main() {
  if (MODE === 'http') {
    const app = express();
    app.use(express.json());

    const transports = {};

    // Streamable HTTP endpoint — all MCP communication on /mcp
    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];

      try {
        let transport;

        if (sessionId && transports[sessionId]) {
          transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports[sid] = transport;
              console.error(`[638labs-mcp] Session initialized: ${sid}`);
            },
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports[sid]) {
              console.error(`[638labs-mcp] Session closed: ${sid}`);
              delete transports[sid];
            }
          };

          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID' },
            id: null,
          });
          return;
        }

        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error('[638labs-mcp] Error handling request:', err);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    // GET /mcp — SSE stream for server-initiated messages
    app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    });

    // DELETE /mcp — session termination
    app.delete('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }
      await transports[sessionId].handleRequest(req, res);
    });

    app.listen(HTTP_PORT, () => {
      console.error(`[638labs-mcp] Streamable HTTP server listening on http://localhost:${HTTP_PORT}`);
      console.error(`[638labs-mcp] Endpoint: POST/GET/DELETE http://localhost:${HTTP_PORT}/mcp`);
    });

    process.on('SIGINT', async () => {
      for (const id in transports) {
        await transports[id].close();
      }
      process.exit(0);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[638labs-mcp] Server running on stdio — 4 tools loaded');
  }
}

main().catch((err) => {
  console.error('[638labs-mcp] Fatal error:', err);
  process.exit(1);
});
