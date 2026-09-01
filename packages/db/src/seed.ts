import { config } from "dotenv";
import argon2 from "argon2";
import { and, eq } from "drizzle-orm";

import { demoCatalog, demoMerchant, demoPolicy } from "./demo-data.js";
import { createDatabase } from "./client.js";
import { agents, catalogItems, merchants, policies } from "./schema.js";

config({ path: "../../.env" });

const { db, close } = createDatabase();

const demoAgentKey = process.env.DEMO_AGENT_API_KEY;

if (!demoAgentKey?.startsWith("ag_") || demoAgentKey.length < 20) {
  throw new Error(
    "DEMO_AGENT_API_KEY is required for seeding and must start with ag_. Generate one before running pnpm db:seed.",
  );
}

const demoAgentName = "Demo Buyer Agent";
const demoAgentKeyPrefix = demoAgentKey.slice(0, 15);

try {
  const [merchant] = await db
    .insert(merchants)
    .values(demoMerchant)
    .onConflictDoNothing({ target: merchants.name })
    .returning();

  const existingMerchant =
    merchant ?? (await db.select().from(merchants).where(eq(merchants.name, demoMerchant.name)).limit(1))[0];

  if (!existingMerchant) {
    throw new Error("Could not create or load the demo merchant.");
  }

  await db
    .insert(policies)
    .values({ merchantId: existingMerchant.id, ...demoPolicy })
    .onConflictDoUpdate({
      target: policies.merchantId,
      set: { ...demoPolicy, updatedAt: new Date() },
    });

  await db
    .insert(catalogItems)
    .values(demoCatalog.map((item) => ({ merchantId: existingMerchant.id, ...item })))
    .onConflictDoNothing();

  const apiKeyHash = await argon2.hash(demoAgentKey, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const [existingAgent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.merchantId, existingMerchant.id), eq(agents.name, demoAgentName)))
    .limit(1);

  if (existingAgent) {
    await db
      .update(agents)
      .set({ apiKeyPrefix: demoAgentKeyPrefix, apiKeyHash, status: "active" })
      .where(eq(agents.id, existingAgent.id));
  } else {
    await db.insert(agents).values({
      merchantId: existingMerchant.id,
      name: demoAgentName,
      apiKeyPrefix: demoAgentKeyPrefix,
      apiKeyHash,
      status: "active",
    });
  }

  console.log(`Seeded ${demoCatalog.length} catalog items and ${demoAgentName} for ${existingMerchant.name}.`);
} finally {
  await close();
}
