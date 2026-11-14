// Same-origin API client. Every path is relative: in production the ingress
// routes /api to the backend on this same host, and in dev Vite proxies it.

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = body.detail[0].msg
    } catch {
      // Non-JSON error body: keep the status line.
    }
    const err = new Error(detail)
    err.status = res.status
    throw err
  }
  return res.json()
}

export const api = {
  levels: () => request('/api/levels'),
  me: () => request('/api/me'),
  leaderboard: (levelId, limit = 10) =>
    request(`/api/scores?${new URLSearchParams({ ...(levelId ? { level_id: levelId } : {}), limit }).toString()}`),
  mine: (limit = 20) => request(`/api/scores/mine?limit=${limit}`),
  submitScore: (payload) => request('/api/scores', { method: 'POST', body: JSON.stringify(payload) }),
  setProfile: (displayName) =>
    request('/api/profile', { method: 'POST', body: JSON.stringify({ display_name: displayName }) }),
}