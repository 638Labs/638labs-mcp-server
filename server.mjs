#!/usr/bin/env node

/*
  638Labs MCP Server

  Exposes the 638Labs AI registry as MCP tools.
  When connected to Claude Code, Codex, Cursor, or any MCP client:
  - Every registered agent appears as a callable tool
  - Discovery searches the registry by capability
  - Routing goes through the existing e0 gateway
  - Auctions fire transparently when using the auction tool

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
    e0 Gateway (existing, unchanged)
      ↕
    Target AI Endpoint
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
  version: '1.0.0',
});

// ========================
// Tool 1: Discover Agents
// ========================
server.tool(
  '638labs_discover',
  'Search the 638Labs AI registry for available agents, models, and knowledgebases. Returns matching endpoints with their capabilities, pricing, and quality scores.',
  {
    category: z.string().optional().describe('Filter by category (e.g., "chat", "summarization", "code", "data")'),
    model_family: z.string().optional().describe('Filter by model family (e.g., "gpt", "claude", "cohere", "llama")'),
    route_type: z.string().optional().describe('Filter by type: "model", "agent", or "datasource"'),
    query: z.string().optional().describe('Free text search term to match against agent names'),
  },
  async ({ category, model_family, route_type, query }) => {
    try {
      const endpoints = await registry.searchEndpoints({ category, model_family, route_type, query });

      if (endpoints.length === 0) {
        return {
          content: [{ type: 'text', text: 'No matching agents found in the registry.' }]
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
          text: `Found ${results.length} agent(s) in the 638Labs registry:\n\n${JSON.stringify(results, null, 2)}`
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
// Tool 2: Route to Agent
// ========================
server.tool(
  '638labs_route',
  'Send a request to a specific registered AI agent via the 638Labs gateway. Uses the route_name from the registry (e.g., "stolabs/prod-01" or "your-org/agent-v2"). The request is OpenAI-compatible.',
  {
    route_name: z.string().describe('The 638Labs route name (e.g., "stolabs/prod-01")'),
    prompt: z.string().describe('The prompt or message to send to the agent'),
    model: z.string().optional().describe('Optional model override for the target endpoint'),
    provider_api_key: z.string().optional().describe('Optional API key for external providers (OpenAI, Cohere, etc.)'),
  },
  async ({ route_name, prompt, model, provider_api_key }) => {
    try {
      const payload = {
        model: model || 'default',
        messages: [
          { role: 'user', content: prompt }
        ],
      };

      const result = await gateway.routeRequest(route_name, payload, provider_api_key);

      // extract the response text from OpenAI-style response
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
// Tool 3: Auction
// ========================
server.tool(
  '638labs_auction',
  'Submit a job to the 638Labs agentic AI auction. Eligible agents bid in a real-time sealed-bid auction. The winning agent executes the job. Use this when you want the best agent for the task selected by market competition.',
  {
    prompt: z.string().describe('The prompt or task to send to the auction'),
    category: z.string().optional().describe('Filter bidding agents by category (e.g., "chat", "summarization")'),
    model_family: z.string().optional().describe('Filter bidding agents by model family (e.g., "gpt", "cohere")'),
    model_flavour: z.string().optional().describe('Filter bidding agents by model flavour (e.g., "gpt-4o", "command-r"). Use "any" to allow all.'),
    max_price: z.number().optional().describe('Maximum price you are willing to pay (reserve price)'),
  },
  async ({ prompt, category, model_family, model_flavour, max_price }) => {
    try {
      const payload = {
        model: 'default',
        messages: [
          { role: 'user', content: prompt }
        ],
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
        ? `Auction winner: ${winner.route_name}`
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
// Quick Auction Tools — sto_* (namespaced, defensible) + bid (convenience)
// ========================

// Shared handler for all auction shortcut tools
async function auctionShortcut({ prompt, max_price, category }) {
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
        constraints: {},
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
    ? `Auction winner: ${winner.route_name}`
    : 'Auction completed';

  return {
    content: [{
      type: 'text',
      text: `[${auctionInfo}]\n\n${responseText}`
    }]
  };
}

// sto_* tools — namespaced to STO, each pre-sets a category
const stoTools = [
  ['sto_bid',       null,              'Run a 638Labs auction. Agents bid, winner responds. No category filter.'],
  ['sto_summarize', 'summarization',   'Auction: best agent summarizes your text.'],
  ['sto_translate', 'translation',     'Auction: best agent translates your text.'],
  ['sto_chat',      'chat',            'Auction: best chat agent responds to your prompt.'],
  ['sto_code',      'code',            'Auction: best coding agent writes or fixes code.'],
  ['sto_extract',   'extraction',      'Auction: best agent extracts structured data (names, dates, entities) from text.'],
  ['sto_classify',  'classification',  'Auction: best agent classifies text (sentiment, topic, intent, spam).'],
  ['sto_rewrite',   'rewriting',       'Auction: best agent rewrites text (tone change, simplify, formalize).'],
  ['sto_moderate',  'moderation',      'Auction: best agent checks content safety and toxicity.'],
  ['sto_analyze',   'analysis',        'Auction: best agent analyzes data, trends, or reasoning over numbers.'],
  ['sto_air',       null,              'Run a 638Labs AI auction. Agents bid, winner responds. No category filter.'],
  ['stoair',        null,              'Run a 638Labs AI auction. Agents bid, winner responds. No category filter.'],
];

for (const [name, category, description] of stoTools) {
  const schema = {
    prompt: z.string().describe('The prompt or task to send'),
    max_price: z.number().optional().describe('Max price (reserve). Default 5.00'),
  };

  // sto_bid has no fixed category, so allow user to pass one
  if (!category) {
    schema.category = z.string().optional().describe('Filter by category (e.g., "chat", "summarization", "code")');
  }

  server.tool(name, description, schema, async (params) => {
    try {
      return await auctionShortcut({
        prompt: params.prompt,
        max_price: params.max_price,
        category: category || params.category,
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Auction error: ${err.message}` }],
        isError: true,
      };
    }
  });
}

// bid — convenience grab (short name, not namespaced)
server.tool(
  'bid',
  'Shortest way to run an AI auction. Pass a prompt, agents compete, winner responds.',
  {
    prompt: z.string().describe('The prompt or task to auction'),
    category: z.string().optional().describe('Filter by category (e.g., "chat", "summarization", "code")'),
    max_price: z.number().optional().describe('Max price (reserve). Default 5.00'),
  },
  async (params) => {
    try {
      return await auctionShortcut(params);
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Auction error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ========================
// List All Endpoints
// ========================
server.tool(
  '638labs_list',
  'List all active endpoints in the 638Labs registry. Shows a summary of all available agents, models, and knowledgebases with their route names.',
  {},
  async () => {
    try {
      const endpoints = await registry.listEndpoints();

      if (endpoints.length === 0) {
        return {
          content: [{ type: 'text', text: 'No active endpoints found in the registry.' }]
        };
      }

      const summary = endpoints.map(ep =>
        `- ${ep.route_name} (${ep.route_type || 'unknown'}) — ${ep.name || 'unnamed'} [${ep.agent?.online ? 'online' : 'offline'}]${ep.auction?.enabled ? ' [auction]' : ''}`
      ).join('\n');

      return {
        content: [{
          type: 'text',
          text: `638Labs Registry — ${endpoints.length} active endpoint(s):\n\n${summary}`
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error listing endpoints: ${err.message}` }],
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
          // Reuse existing transport for this session
          transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New client initializing — create transport
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
    console.error('[638labs-mcp] Server running on stdio');
  }
}

main().catch((err) => {
  console.error('[638labs-mcp] Fatal error:', err);
  process.exit(1);
});
