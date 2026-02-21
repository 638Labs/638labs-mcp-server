/*
  gateway.mjs
  HTTP client that forwards tool calls to the e0 gateway.
  This is how the MCP server routes requests through the existing infrastructure.
*/

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3005';
const API_KEY = process.env.STOLABS_API_KEY;

/**
 * Route a request through the e0 gateway.
 * This is the same call any HTTP client would make — the MCP server
 * is just another client of the gateway.
 *
 * @param {string} routeName - The 638Labs route (e.g., "stolabs/prod-01")
 * @param {object} payload - The OpenAI-compatible request body
 * @param {string} providerApiKey - Optional provider API key for external endpoints
 * @returns {object} The response from the target endpoint
 */
export async function routeRequest(routeName, payload, providerApiKey) {
  const headers = {
    'Content-Type': 'application/json',
    'x-stolabs-api-key': API_KEY,
    'x-stolabs-route-name': routeName,
  };

  // add provider auth if the endpoint needs it (external providers like OpenAI)
  if (providerApiKey) {
    headers['Authorization'] = providerApiKey;
  }

  const response = await fetch(`${GATEWAY_URL}/api/v1/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gateway error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

/**
 * Route a request through the auction system.
 * Sends to stolabs/stoAuction route which triggers sealed-bid auction.
 */
export async function auctionRequest(payload) {
  return routeRequest('stolabs/stoAuction', payload);
}
