// Lightweight Open Graph / meta-tag scraper for user-pasted links. Server-only.
// No API key — this fetches the URL the user gave us directly, not a paid
// provider, so it degrades to a plain error message rather than a
// ProviderSetupCard when it can't read a page.
//
// Extraction is deliberately limited to two deterministic sources, so every
// field written into an activity or a stay is traceable to something the page
// (or Google) actually said — never an AI guess:
//   1. Open Graph / meta tags, from <head> — title, description, image, price.
//   2. schema.org JSON-LD blocks (Event/LocalBusiness/Product/TouristAttraction)
//      — ticket price, reservation requirement, hours, address. These often
//      live in <body>, not <head>, so a page with no JSON-LD in the fast
//      head-only pass gets one bounded extra read looking specifically for it.
// A field stays null when neither source has it — it is never inferred.

const TIMEOUT_MS = 8000;
const HEAD_MAX_BYTES = 300_000; // enough to cover <head>; avoids downloading huge pages
const BODY_SCAN_MAX_BYTES = 1_500_000; // bounded second pass, only when head has no JSON-LD

export interface UrlMetadata {
  title: string | null;
  description: string | null;
  image: string | null;
  price_cents: number | null;
  currency: string | null;
  source_url: string;
  /** From JSON-LD `offers`/`openingHoursSpecification`/etc — never inferred. */
  requires_reservation: boolean | null;
  ticket_price_cents: number | null;
  /** "Monday: 9am-5pm" style lines, or a raw JSON-LD hours spec, joined. */
  hours: string | null;
  address: string | null;
  /** Rarely present in JSON-LD; left null far more often than filled. */
  typical_visit_hours: number | null;
  /** Built only from explicit structured fields above — never a freeform summary. */
  notes: string | null;
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

/** Structural view of the schema.org shapes we look for — deliberately loose,
 * since real-world JSON-LD is inconsistent and this must never throw. */
type JsonLdOffer = { price?: string | number; availability?: string };

interface JsonLdNode {
  "@type"?: string | string[];
  "@graph"?: JsonLdNode[];
  offers?: JsonLdOffer | JsonLdOffer[];
  openingHoursSpecification?: unknown;
  address?: { streetAddress?: string; addressLocality?: string; addressRegion?: string } | string;
  paymentAccepted?: string;
}

const JSONLD_TYPES = ["Event", "LocalBusiness", "Product", "TouristAttraction"];

function flattenJsonLd(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed: unknown = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === "object") {
          const node = item as JsonLdNode;
          if (Array.isArray(node["@graph"])) nodes.push(...node["@graph"]);
          else nodes.push(node);
        }
      }
    } catch {
      // Malformed JSON-LD is common in the wild — skip, never throw.
    }
  }
  return nodes;
}

function matchesJsonLdType(node: JsonLdNode): boolean {
  const t = node["@type"];
  const types = Array.isArray(t) ? t : t ? [t] : [];
  return types.some((x) => JSONLD_TYPES.includes(x));
}

function formatAddress(addr: JsonLdNode["address"]): string | null {
  if (!addr) return null;
  if (typeof addr === "string") return addr;
  const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

interface JsonLdExtract {
  requires_reservation: boolean | null;
  ticket_price_cents: number | null;
  hours: string | null;
  address: string | null;
  notes: string | null;
}

function extractFromJsonLd(html: string): JsonLdExtract {
  const node = flattenJsonLd(html).find(matchesJsonLdType);
  if (!node) {
    return {
      requires_reservation: null,
      ticket_price_cents: null,
      hours: null,
      address: null,
      notes: null,
    };
  }

  const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  const priceRaw = offer?.price;
  const price =
    priceRaw != null && priceRaw !== "" ? Math.round(parseFloat(String(priceRaw)) * 100) : null;
  const ticket_price_cents = price != null && Number.isFinite(price) ? price : null;

  // schema.org's `offers.availability` values (InStock, SoldOut, PreOrder…)
  // don't reliably map to "you must reserve ahead" — only PreSale/PreOrder
  // are unambiguous about that, so anything else is left null rather than
  // guessed.
  const availability = offer?.availability ?? null;
  const requires_reservation =
    typeof availability === "string"
      ? /presale|preorder/i.test(availability)
        ? true
        : null
      : null;

  // Only the plain-string form of openingHoursSpecification is used — the
  // structured object form (dayOfWeek/opens/closes) would need real
  // formatting we don't attempt, so it's left null rather than risking a
  // garbled rendering of raw JSON.
  const hoursSpec = node.openingHoursSpecification;
  const hours =
    typeof hoursSpec === "string"
      ? hoursSpec
      : Array.isArray(hoursSpec) && hoursSpec.every((h) => typeof h === "string")
        ? (hoursSpec as string[]).join("; ")
        : null;

  const address = formatAddress(node.address);

  const notesParts: string[] = [];
  if (requires_reservation) notesParts.push("Reservation required.");
  if (typeof node.paymentAccepted === "string" && /cash/i.test(node.paymentAccepted)) {
    notesParts.push("Cash only.");
  }
  const notes = notesParts.length ? notesParts.join(" ") : null;

  return { requires_reservation, ticket_price_cents, hours, address, notes };
}

async function readBody(url: URL, maxBytes: number, stopPattern?: RegExp): Promise<string> {
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
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (stopPattern?.test(html)) break;
    }
    await reader.cancel().catch(() => {});
  } finally {
    clearTimeout(timer);
  }
  return html;
}

export async function fetchUrlMetadata(rawUrl: string): Promise<UrlMetadata> {
  const url = isSafeUrl(rawUrl);
  if (!url) throw new Error("That doesn't look like a valid, public URL.");

  const head = await readBody(url, HEAD_MAX_BYTES, /<\/head>/i);

  const priceRaw =
    metaContent(head, "product:price:amount") ?? metaContent(head, "og:price:amount");
  const price = priceRaw ? Math.round(parseFloat(priceRaw) * 100) : null;

  let jsonLd = extractFromJsonLd(head);
  // JSON-LD for events/venues frequently sits in <body>, past where the fast
  // head-only pass stops — only pay for a second, larger read when the first
  // one found nothing structured at all.
  const hadNoJsonLd =
    jsonLd.requires_reservation == null &&
    jsonLd.ticket_price_cents == null &&
    jsonLd.hours == null &&
    jsonLd.address == null;
  if (hadNoJsonLd) {
    try {
      const full = await readBody(url, BODY_SCAN_MAX_BYTES, /<\/body>/i);
      jsonLd = extractFromJsonLd(full);
    } catch {
      // Second pass is a best-effort enrichment — the head-derived fields
      // above still stand if this fails.
    }
  }

  return {
    title: metaContent(head, "og:title") ?? titleTagFallback(head),
    description: metaContent(head, "og:description") ?? metaContent(head, "description"),
    image: metaContent(head, "og:image"),
    price_cents: price != null && Number.isFinite(price) ? price : null,
    currency: metaContent(head, "product:price:currency") ?? metaContent(head, "og:price:currency"),
    source_url: url.toString(),
    requires_reservation: jsonLd.requires_reservation,
    ticket_price_cents: jsonLd.ticket_price_cents,
    hours: jsonLd.hours,
    address: jsonLd.address,
    typical_visit_hours: null,
    notes: jsonLd.notes,
  };
}
