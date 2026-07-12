/**
 * Kaiten API клиент.
 * Гарантии: таймаут, ретраи с backoff на 429/5xx, пагинация с паузами
 * (лимит Kaiten ~5 req/s), неожиданная форма ответа = ошибка, не "0 записей".
 */

const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 250;
const MAX_RETRIES = 3;

function baseUrl(): string {
  const url = process.env.KAITEN_API_URL;
  if (!url) throw new Error("KAITEN_API_URL is not configured");
  return url.replace(/\/$/, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function kaitenFetch<T>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const token = process.env.KAITEN_API_TOKEN;
  if (!token) throw new Error("KAITEN_API_TOKEN is not configured");

  const url = new URL(`${baseUrl()}/api/latest/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  let lastError: Error = new Error("unreachable");
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Kaiten ${res.status} on ${path}`);
        continue; // retry
      }
      if (!res.ok) {
        throw new Error(`Kaiten ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // сетевые ошибки/таймауты тоже ретраим
    }
  }
  throw lastError;
}

async function fetchAllPages<T>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await kaitenFetch<unknown>(path, { ...params, limit: PAGE_SIZE, offset });
    if (!Array.isArray(page)) {
      throw new Error(`Kaiten: unexpected response shape on ${path} (offset ${offset})`);
    }
    all.push(...(page as T[]));
    if (page.length < PAGE_SIZE) return all;
    offset += page.length;
    await sleep(PAGE_DELAY_MS);
  }
}

// Типы — только используемые синком поля; остальное уходит в raw.
export interface KaitenEntity {
  id: number;
  [key: string]: unknown;
}

export const kaiten = {
  spaces: () => kaitenFetch<KaitenEntity[]>("spaces"),
  spaceBoards: (spaceId: number) => kaitenFetch<KaitenEntity[]>(`spaces/${spaceId}/boards`),
  users: () => fetchAllPages<KaitenEntity>("company/users"),
  tags: () => fetchAllPages<KaitenEntity>("tags"),
  cardTypes: () => kaitenFetch<KaitenEntity[]>("card-types"),
  cards: (opts: { updatedAfter?: string } = {}) =>
    fetchAllPages<KaitenEntity>(
      "cards",
      opts.updatedAfter ? { updated_after: opts.updatedAfter } : {}
    ),
  timeLogs: (from: string, to: string) =>
    fetchAllPages<KaitenEntity>("time-logs", { from, to }),
};
