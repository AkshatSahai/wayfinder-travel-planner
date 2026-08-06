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
      return { meta, error: null };
    } catch (err) {
      return {
        meta: null,
        error: err instanceof Error ? err.message : "Couldn't read that link.",
      };
    }
  });
