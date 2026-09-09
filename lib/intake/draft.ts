import { buildPrompt, parseDraft } from "./content";
export type DraftOptions = {
  /** Pin one model for evaluation; disables fallback. */
  model?: string;
  onResponse?: (result: {
    model: string;
    status: number;
    tokens: number | null;
  }) => void;
};
export async function generateDraft(text: string, options: DraftOptions = {}) {
  if (!process.env.CHUTES_API_KEY)
    throw new Error("Drafting is not configured. Contact support.");
  const models = options.model
    ? [options.model]
    : (
        process.env.INTAKE_MODELS ||
        "google/gemma-4-31B-turbo-TEE,deepseek-ai/DeepSeek-V3.2-TEE"
      )
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 2);
  let correctionUsed = false;
  modelLoop: for (const model of models) {
    const messages = buildPrompt(text);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(
          "https://llm.chutes.ai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.CHUTES_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages,
              temperature: 0.2,
              max_tokens: 6000,
            }),
            signal: AbortSignal.timeout(90000),
          },
        );
        if (!response.ok)
          options.onResponse?.({
            model,
            status: response.status,
            tokens: null,
          });
        if (response.status === 429) throw new Error("rate-limit");
        if (!response.ok) break;
        const value = await response.json();
        options.onResponse?.({
          model,
          status: response.status,
          tokens: value.usage?.total_tokens ?? null,
        });
        try {
          return parseDraft(value.choices?.[0]?.message?.content || "", text);
        } catch {
          if (correctionUsed) break modelLoop;
          correctionUsed = true;
          // Fixed trusted correction only; never promote provider/source text into instructions.
          messages.push({
            role: "system",
            content:
              "The previous response failed validation. Regenerate from the original source. Return valid JSON, use the target language for ALL headings, summary, prose, title and tags. Put the required localized summary heading and paragraph first, the required reviewer heading and at least three distinct ul/li checks last. Preserve all source tables with identical cells, row order and column order. Follow every original constraint.",
          });
        }
      } catch (error) {
        if (error instanceof Error && error.message === "rate-limit")
          throw new Error(
            "Could not create a draft. Wait a moment, then upload again.",
          );
        // Never expose provider responses or document contents in diagnostics.
        break;
      }
    }
  }
  throw new Error(
    "Could not create a draft. Wait a moment, then upload again.",
  );
}
