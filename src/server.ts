import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// ---- Google Places photo proxy ----
//
// Places photo URLs used to be built server-side with the API key embedded and
// handed to the browser as an <img src>, publishing GOOGLE_API_KEY to anyone who
// opened devtools. The key now stays server-side and the browser asks us for the
// bytes instead.
//
// SECURITY: `name` is interpolated into an upstream URL that we sign with our
// key, so it MUST be validated against the exact shape Places issues. Without
// this check the route is an open relay — anyone could point it at another
// Google endpoint and have us authenticate the call on their behalf.
//
// This lives here rather than in a route file because this version of TanStack
// Start ships no server-route API (no createServerFileRoute/ServerRoute export),
// and a server function can't stream raw image bytes.
const PHOTO_NAME_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
const PHOTO_PATH = "/api/places/photo";
const MIN_PHOTO_WIDTH = 64;
const MAX_PHOTO_WIDTH = 1600;
const DEFAULT_PHOTO_WIDTH = 800;

async function handlePlacePhoto(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  if (!PHOTO_NAME_RE.test(name)) {
    return new Response("Bad photo reference", { status: 400 });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  // A missing key means "no photo", not "the site is broken".
  if (!apiKey) return new Response(null, { status: 404 });

  const requested = Number(url.searchParams.get("w"));
  const width = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), MIN_PHOTO_WIDTH), MAX_PHOTO_WIDTH)
    : DEFAULT_PHOTO_WIDTH;

  try {
    const upstream = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${width}&key=${apiKey}`,
      { redirect: "follow" },
    );
    if (!upstream.ok || !upstream.body) {
      // Deliberately terse: never surface the upstream URL or the key.
      console.error(`[places-photo] upstream ${upstream.status} for ${name}`);
      return new Response(null, { status: 404 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
        // Photo bytes are immutable per reference; without caching, every render
        // re-bills a Places photo request.
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    console.error("[places-photo] fetch failed:", err);
    return new Response(null, { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (new URL(request.url).pathname === PHOTO_PATH) {
        return await handlePlacePhoto(request);
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
