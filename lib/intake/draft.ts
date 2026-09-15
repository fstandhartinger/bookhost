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
function intakeEndpoint() {
  const base = (
    process.env.INTAKE_BASE_URL || "https://api.tensorx.ai/v1"
  ).replace(/\/+$/, "");
  return `${base}/chat/completions`;
}
function intakeApiKey() {
  const name = process.env.INTAKE_API_KEY_ENV || "TENSORX_API_KEY";
  return process.env[name];
}
export async function generateDraft(text: string, options: DraftOptions = {}) {
  const apiKey = intakeApiKey();
  if (!apiKey)
    throw new Error("Drafting is not configured. Contact support.");
  const models = options.model
    ? [options.model]
    : (
        process.env.INTAKE_MODELS ||
        "deepseek/deepseek-v4.1-flash,z-ai/glm-5.3-flash"
      )
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 2);
  const endpoint = intakeEndpoint();
  let correctionUsed = false;
  modelLoop: for (const model of models) {
    const messages = buildPrompt(text);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.2,
            max_tokens: 6000,
          }),
          signal: AbortSignal.timeout(90000),
        });
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
