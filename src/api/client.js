// All server calls go through here. Cookies carry the session; nothing secret is stored in JS.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON (e.g. proxy error page).
  }
  // A staff call rejected as signed-out means the session ended (expired or deactivated): let the app re-check it.
  if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("amd:signed-out"));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Something went wrong.");
  return data;
}
