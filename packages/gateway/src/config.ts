import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  MCP_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
  HOST: z.string().min(1).default("127.0.0.1"),
  AGENTGATE_BASE_URL: z.url().default("http://127.0.0.1:3001"),
  DATABASE_URL: z.preprocess((value) => (value === "" ? undefined : value), z.url().optional()),
  MERCHANT_NAME: z.string().min(1).default("Northstar Audio"),
  RAZORPAY_KEY_ID: z.preprocess((value) => (value === "" ? undefined : value), z.string().optional()),
  RAZORPAY_KEY_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional(),
  ),
});

export type GatewayConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment = process.env): GatewayConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new Error(`Invalid gateway environment: ${result.error.message}`);
  }

  return result.data;
}