// Thin client for the Unleash Live REST API.
// Docs: https://developer.unleashlive.com  Base: https://api.unleashlive.com
// Auth: Personal Access Token sent as `Authorization: Bearer <ul_pat_...>`.

const BASE_URL = "https://api.unleashlive.com";

export class UnleashClient {
  constructor(token) {
    if (!token) throw new Error("Missing token. Set UL_PAT in your environment.");
    this.token = token;
  }

  async #get(path) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GET ${path} -> ${res.status} ${res.statusText}\n${body}`);
    }
    const text = await res.text();
    // Some endpoints (e.g. /version) return a bare string, others return JSON.
    try {
      return JSON.parse(text);
    } catch {
      return text.replace(/^"|"$/g, "");
    }
  }

  // Sanity check that the token works. Returns the analytics API version string.
  version() {
    return this.#get("/v1/analytics/version");
  }

  // Devices that have produced analytics.
  analyticsDevices() {
    return this.#get("/v1/analytics/devices");
  }

  // List flight logs for the team (non-paginated). Optional filters via query object.
  async flights(filters = {}) {
    const qs = new URLSearchParams(filters).toString();
    const data = await this.#get(`/v1/flights${qs ? `?${qs}` : ""}`);
    return data.items ?? data ?? [];
  }

  // Download and parse a flight log file (the rich per-sample telemetry track).
  // s3Path comes from a flight list item. Host is the flights CDN, not the API.
  async flightLog(s3Path) {
    const res = await fetch(`https://flights.unleashlive.com/${s3Path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`flight log ${s3Path} -> ${res.status}`);
    return JSON.parse(await res.text());
  }

  // Descriptive ("tableau") analytics for a device across a time window.
  // Walks every page and returns the flattened array of detection rows.
  async analytics(deviceId, fromMs, toMs) {
    const rows = [];
    let page = 1;
    let totalPages = 1;
    do {
      const path = `/v1/analytics/tableau/${deviceId}/${fromMs}/${toMs}/${page}`;
      const res = await this.#get(path);
      const data = Array.isArray(res) ? res : res.data ?? [];
      rows.push(...data);
      totalPages = (res && res.total_num_pages) || 1;
      page += 1;
    } while (page <= totalPages);
    return rows;
  }
}
