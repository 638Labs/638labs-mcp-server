/*
  registry.mjs
  Calls the 638Labs main server public discovery API.
  Returns endpoint data that gets mapped to MCP tool definitions.
*/

const API_URL = process.env.API_URL || 'http://localhost:8080';

/**
 * List all active public endpoints.
 */
export async function listEndpoints() {
  const res = await fetch(`${API_URL}/api/aiendpoint/public`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.data || [];
}

/**
 * Search endpoints by capability filters.
 */
export async function searchEndpoints({ category, model_family, model_flavour, route_type, query } = {}) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (model_family) params.set('model_family', model_family);
  if (model_flavour) params.set('model_flavour', model_flavour);
  if (route_type) params.set('route_type', route_type);
  if (query) params.set('query', query);

  const qs = params.toString();
  const url = `${API_URL}/api/aiendpoint/discover${qs ? '?' + qs : ''}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.data || [];
}
