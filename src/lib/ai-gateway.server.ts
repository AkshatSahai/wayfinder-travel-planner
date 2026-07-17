import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

// Provider fallback chain:
//   1. LOVABLE_API_KEY  → Lovable AI gateway (auto-provisioned inside Lovable Cloud)
//   2. GEMINI_API_KEY   → official Google provider (native structured outputs —
//      Google's OpenAI-compatible endpoint silently drops JSON-schema enforcement,
//      which breaks Output.object validation)
// Model ids differ per provider ("google/gemini-…" vs "gemini-…"); AI_MODEL overrides.

const LOVABLE_MODEL = "google/gemini-3-flash-preview";
const GOOGLE_MODEL = "gemini-3-flash-preview";

export function createGateway() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    return createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: {
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
    });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    return createGoogleGenerativeAI({ apiKey: geminiKey });
  }

  throw new Error("GEMINI_API_KEY missing");
}

export const CHAT_MODEL =
  process.env.AI_MODEL ?? (process.env.LOVABLE_API_KEY ? LOVABLE_MODEL : GOOGLE_MODEL);
