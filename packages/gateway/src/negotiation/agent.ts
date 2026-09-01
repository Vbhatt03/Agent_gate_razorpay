import { z } from "zod";

const GroqResponseSchema = z.object({
  offered_price_paise: z.number().int().positive(),
  reason: z.string().min(1),
});

export type NegotiationAgentInput = {
  itemName: string;
  itemSku: string;
  listedPricePaise: number;
  minimumPricePaise: number;
  targetPricePaise: number;
  groqApiKey: string;
};

export type NegotiationAgentOutput =
  | { success: true; offeredPricePaise: number; reason: string; usedFallback: false }
  | { success: true; offeredPricePaise: number; reason: string; usedFallback: true; fallbackReason: string }
  | { success: false; error: string };

export async function runNegotiationAgent(
  input: NegotiationAgentInput,
): Promise<NegotiationAgentOutput> {
  const { itemName, itemSku, listedPricePaise, minimumPricePaise, targetPricePaise, groqApiKey } = input;

  const systemPrompt = `You are a pricing negotiation assistant for a merchant selling "${itemName}" (SKU: ${itemSku}).

You may only propose a price between ₹${(minimumPricePaise / 100).toFixed(2)} and ₹${(listedPricePaise / 100).toFixed(2)} (inclusive).

Never claim a price outside this range exists. Never suggest a price below the minimum.

Respond ONLY as valid JSON with this exact structure:
{"offered_price_paise": number, "reason": "string"}

Your reason should be a brief, plain-English explanation grounded in the product facts.`;

  const userPrompt = `A buyer is interested in "${itemName}" and is targeting a price of ₹${(targetPricePaise / 100).toFixed(2)}. The listed price is ₹${(listedPricePaise / 100).toFixed(2)}. What is your best offer within your allowed range?`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, error: `Groq API error: ${response.status} — ${text}` };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    console.log("[DEBUG] Raw LLM content:", JSON.stringify(content));
    let parsed: z.infer<typeof GroqResponseSchema>;
    try {
      let text = content.trim();
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        text = text.slice(jsonStart, jsonEnd + 1);
      }
      parsed = GroqResponseSchema.parse(JSON.parse(text));
    } catch {
      return {
        success: true,
        offeredPricePaise: minimumPricePaise,
        reason: "Could not parse LLM response; using minimum allowed price as fallback.",
        usedFallback: true,
        fallbackReason: "malformed_llm_output",
      };
    }

    const { offered_price_paise, reason } = parsed;

    if (offered_price_paise < minimumPricePaise || offered_price_paise > listedPricePaise) {
      return {
        success: true,
        offeredPricePaise: minimumPricePaise,
        reason: `LLM offer (₹${(offered_price_paise / 100).toFixed(2)}) was outside allowed range; using minimum allowed price.`,
        usedFallback: true,
        fallbackReason: "llm_out_of_bounds",
      };
    }

    return { success: true, offeredPricePaise: offered_price_paise, reason, usedFallback: false };
  } catch (err) {
    return {
      success: true,
      offeredPricePaise: minimumPricePaise,
      reason: `Negotiation agent unavailable; using minimum allowed price as fallback.`,
      usedFallback: true,
      fallbackReason: `negotiation_agent_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
