/*
  gateway.mjs
  HTTP client that forwards tool calls to the e0 gateway.
  The API key is passed per-request from the user's config, not from server env.
*/

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3005';

/**
 * Route a request through the e0 gateway.
 *
 * @param {string} routeName - The 638Labs route (e.g., "stolabs/prod-01")
 * @param {object} payload - The OpenAI-compatible request body
 * @param {string} apiKey - The user's STOLABS_API_KEY
 * @param {string} providerApiKey - Optional provider API key for external endpoints
 * @returns {object} The response from the target endpoint
 */
export async function routeRequest(routeName, payload, apiKey, providerApiKey) {
  if (!apiKey) {
    throw new Error('STOLABS_API_KEY is not configured. Sign up at https://app.638labs.com and add your key.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-stolabs-api-key': apiKey,
    'x-stolabs-route-name': routeName,
  };

  if (providerApiKey) {
    headers['Authorization'] = providerApiKey;
  }

  const response = await fetch(`${GATEWAY_URL}/api/v1/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
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
export async function auctionRequest(payload, apiKey) {
  return routeRequest('stolabs/stoAuction', payload, apiKey);
}
