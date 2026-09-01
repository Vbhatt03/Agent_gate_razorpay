import crypto from "node:crypto";
import { z } from "zod";
import { RazorpayWebhookPayloadSchema, type RazorpayWebhookPayload } from "@agentgate/shared";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RazorpayOrder {
  razorpayOrderId: string;
  paymentLink: string;
}

export interface CreateOrderParams {
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}

export interface WebhookVerificationResult {
  valid: boolean;
  payload?: RazorpayWebhookPayload;
  error?: string;
}

// ── Main adapter ─────────────────────────────────────────────────────────────

export function createRazorpayAdapter(keyId: string, keySecret: string) {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  async function createOrder(params: CreateOrderParams): Promise<RazorpayOrder> {
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        currency: "INR",
        receipt: params.receipt,
        notes: params.notes,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown");
      throw new Error(`Razorpay order creation failed: HTTP ${response.status} — ${text}`);
    }

    const data = await response.json();
    const orderId: string = data.id;
    const shortUrl: string = data.short_url;

    return {
      razorpayOrderId: orderId,
      paymentLink: shortUrl ?? `https://rzp.io/i/${orderId}`,
    };
  }

  async function createPaymentLink(params: CreateOrderParams): Promise<RazorpayOrder> {
    const response = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        currency: "INR",
        reference_id: params.receipt,
        description: params.notes.description ?? "AgentGate Order",
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: params.notes,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown");
      throw new Error(`Razorpay payment link creation failed: HTTP ${response.status} — ${text}`);
    }

    const data = await response.json();
    return {
      razorpayOrderId: data.order_id,
      paymentLink: data.short_url,
    };
  }

  function verifyWebhookSignature(
    payload: Buffer,                                                                                                                            
    signature: string,
    secret: string,
  ): WebhookVerificationResult {
    try {
      const expected = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
        return { valid: false, error: "signature_mismatch" };
      }

      const parsed = JSON.parse(payload.toString("utf-8"));
      const validated = RazorpayWebhookPayloadSchema.safeParse(parsed);

      if (!validated.success) {
        return { valid: false, error: "payload_validation_failed" };
      }

      return { valid: true, payload: validated.data };
    } catch (err) {
      return { valid: false, error: String(err) };
    }
  }

  return { createOrder, createPaymentLink, verifyWebhookSignature };
}

export type RazorpayAdapter = ReturnType<typeof createRazorpayAdapter>;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     