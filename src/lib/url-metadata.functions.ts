import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { UrlMetadata } from "@/lib/providers/url-metadata.server";

export const fetchLinkMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().min(4).max(1000) }).parse(d))
  .handler(async ({ data }): Promise<{ meta: UrlMetadata | null; error: string | null }> => {
    try {
      const { fetchUrlMetadata } = await import("./providers/url-metadata.server");
      const meta = await fetchUrlMetadata(data.url);
      // Backfill hours/address from Google Places when the page's own JSON-LD
      // didn't have them — only for pages that resolved to a real venue name,
      // and only what Places actually returns. Best-effort: no GOOGLE_API_KEY,
      // no match, or a lookup error all just leave those fields as fetched.
      if (meta.title && (meta.hours == null || meta.address == null)) {
        try {
          const { lookupPlaceDetails } = await import("./providers/google-places.server");
          const place = await lookupPlaceDetails(meta.title, meta.address);
          if (place) {
            if (meta.hours == null && place.hours) meta.hours = place.hours.join("; ");
            if (meta.address == null && place.address) meta.address = place.address;
          }
        } catch {
          // Places enrichment is optional — the page-derived fields stand either way.
        }
      }
      return { meta, error: null };
    } catch (err) {
      return {
        meta: null,
        error: err instanceof Error ? err.message : "Couldn't read that link.",
      };
    }
  });
