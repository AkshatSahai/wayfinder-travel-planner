// Lightweight Open Graph / meta-tag scraper for user-pasted links. Server-only.
// No API key — this fetches the URL the user gave us directly, not a paid
// provider, so it degrades to a plain error message rather than a
// ProviderSetupCard when it can't read a page.

const TIMEOUT_MS = 8000;
const MAX_BYTES = 300_000; // enough to cover <head>; avoids downloading huge pages

export interface UrlMetadata {
  title: string | null;
  description: string | null;
  image: string | null;
  price_cents: number | null;
  currency: string | null;
  source_url: string;
}

function isSafeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  // Basic SSRF guard: block loopback, link-local/cloud-metadata, and private ranges.
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "169.254.169.254" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
    return null;
  return u;
}

function metaContent(html: string, prop: string): string | null {
  const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']|` +
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
    "i",
  );
  const m = re.exec(html);
  const val = m?.[1] ?? m?.[2];
  return val ? val.trim() : null;
}

function titleTagFallback(html: string): string | null {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m ? m[1].trim() : null;
}

export async function fetchUrlMetadata(rawUrl: string): Promise<UrlMetadata> {
  const url = isSafeUrl(rawUrl);
  if (!url) throw new Error("That doesn't look like a valid, public URL.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let html = "";
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WayfinderBot/1.0)" },
    });
    if (!res.ok || !res.body) throw new Error(`Fetch failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break; // meta tags live in <head>; stop early
    }
    await reader.cancel().catch(() => {});
  } finally {
    clearTimeout(timer);
  }

  const priceRaw =
    metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount");
  const price = priceRaw ? Math.round(parseFloat(priceRaw) * 100) : null;

  return {
    title: metaContent(html, "og:title") ?? titleTagFallback(html),
    description: metaContent(html, "og:description") ?? metaContent(html, "description"),
    image: metaContent(html, "og:image"),
    price_cents: price != null && Number.isFinite(price) ? price : null,
    currency: metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency"),
    source_url: url.toString(),
  };
}
