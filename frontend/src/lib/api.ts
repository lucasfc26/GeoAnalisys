/** Cliente HTTP da API (mesma origem: /api — proxy do Vite em dev, backend em produção). */

export const API_BASE = '/api';
const TIMEOUT_MS = 60_000;

export type ApiErrorCode =
  'OFFLINE' | 'TIMEOUT' | 'NETWORK' | 'DATABASE_UNAVAILABLE' | 'INVALID_COORDINATES' | string;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: ApiErrorCode,
  ) {
    super(message);
  }
}

export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'x-user-id': import.meta.env.VITE_USER_ID || 'local' };
  if (import.meta.env.VITE_API_TOKEN) h['x-api-key'] = import.meta.env.VITE_API_TOKEN;
  return h;
}

export function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function rawRequest(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ApiError('Sem conexão com a rede.', 0, 'OFFLINE');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), TIMEOUT_MS);
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason));
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      // FormData (upload de arquivo): o navegador define o Content-Type multipart com o boundary.
      headers: {
        ...authHeaders(),
        ...(init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      },
      signal: ctrl.signal,
    });
  } catch (err) {
    if (ctrl.signal.aborted && ctrl.signal.reason === 'timeout') {
      throw new ApiError('A requisição excedeu o tempo limite.', 0, 'TIMEOUT');
    }
    if (signal?.aborted) throw err;
    throw new ApiError('Não foi possível conectar à API. O backend está rodando?', 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    let code: string = String(res.status);
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join('; ') : (body.message ?? message);
      code = body.error ?? code;
    } catch {
      /* corpo não-JSON */
    }
    if (res.status === 502 || res.status === 504) {
      if (code === String(res.status)) {
        message = 'Backend indisponível.';
        code = 'NETWORK';
      }
    }
    throw new ApiError(message, res.status, code);
  }
  return res;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await rawRequest(path, init, signal);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, {}, signal),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }, signal),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', ...(body ? { body: JSON.stringify(body) } : {}) }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Erro inesperado';
}
