import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({ text: z.string().min(1).max(2000) });

const Schema = z.object({
  hidden: z.boolean(),
  category: z.enum([
    "harassment",
    "hate",
    "self_harm",
    "violence",
    "sexual",
    "safe",
  ]),
  severity: z.enum(["none", "mild", "moderate", "severe"]),
  reason: z.string().max(200),
});

export const classifyCommentAI = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      // Fail open — let regex do its job
      return { hidden: false, category: "safe", severity: "none", reason: "ai_unavailable" };
    }
    try {
      const gateway = createLovableAiGatewayProvider(key);
      const { output } = await generateText({
        model: gateway("openai/gpt-5-mini"),
        output: Output.object({ schema: Schema }),
        system:
          "You are a strict community moderator. Classify the user comment for: harassment, hate speech, self-harm encouragement, violent threats, or sexual harassment. " +
          "Set hidden=true if the comment targets, demeans, threatens, or encourages harm toward a person or group, even subtly or sarcastically. " +
          "Pick the best category (use 'safe' only when hidden=false). Severity: mild/moderate/severe when hidden=true, else 'none'. Keep reason under 20 words.",
        prompt: `Comment:\n"""${data.text}"""`,
      });
      return output;
    } catch (e) {
      console.error("AI moderation failed:", e);
      return { hidden: false, category: "safe", severity: "none", reason: "ai_error" };
    }
  });
