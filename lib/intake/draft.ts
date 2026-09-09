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
  for (const model of models) {
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
            messages: buildPrompt(text),
            temperature: 0.2,
            max_tokens: 6000,
          }),
          signal: AbortSignal.timeout(90000),
        },
      );
      if (!response.ok)
        options.onResponse?.({ model, status: response.status, tokens: null });
      if (response.status === 429) throw new Error("rate-limit");
      if (!response.ok) continue;
      const value = await response.json();
      options.onResponse?.({
        model,
        status: response.status,
        tokens: value.usage?.total_tokens ?? null,
      });
      return parseDraft(value.choices?.[0]?.message?.content || "", text);
    } catch (error) {
      if (error instanceof Error && error.message === "rate-limit") break;
      // Never expose provider responses or document contents in diagnostics.
    }
  }
  throw new Error(
    "Could not create a draft. Wait a moment, then upload again.",
  );
}
