import { z } from "zod";

const responseSchema = z.object({
  id: z.string().min(1),
  order_id: z.string().min(1),
  short_url: z.url(),
});

export type PaymentLinkProvider = {
  create(input: {
    amountPaise: number;
    referenceId: string;
    description: string;
    notes: Record<string, string>;
  }): Promise<{ razorpayOrderId: string; paymentLink: string }>;
};

export function createRazorpayPaymentLinkProvider(keyId: string, keySecret: string): PaymentLinkProvider {
  const authorization = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  return {
    async create(input) {
      const response = await fetch("https://api.razorpay.com/v1/payment_links", {
        method: "POST",
        headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: "INR",
          reference_id: input.referenceId,
          description: input.description,
          notify: { sms: false, email: false },
          reminder_enable: false,
          notes: input.notes,
        }),
      });
      if (!response.ok) {
        throw new Error(`Razorpay payment-link creation failed with HTTP ${response.status}.`);
      }

      const payload = responseSchema.parse(await response.json());
      return { razorpayOrderId: payload.order_id, paymentLink: payload.short_url };
    },
  };
}
