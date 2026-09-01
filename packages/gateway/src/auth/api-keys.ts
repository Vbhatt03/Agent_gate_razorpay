import argon2 from "argon2";
import { randomBytes } from "node:crypto";

const keyPrefixLength = 15;

export function createAgentApiKey(): string {
  return `ag_${randomBytes(24).toString("base64url")}`;
}

export function getAgentApiKeyPrefix(apiKey: string): string {
  if (!apiKey.startsWith("ag_") || apiKey.length <= keyPrefixLength) {
    throw new Error("Agent API key has an invalid format.");
  }

  return apiKey.slice(0, keyPrefixLength);
}

export async function hashAgentApiKey(apiKey: string): Promise<string> {
  getAgentApiKeyPrefix(apiKey);

  return argon2.hash(apiKey, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyAgentApiKey(apiKey: string, hash: string): Promise<boolean> {
  try {
    getAgentApiKeyPrefix(apiKey);
    return await argon2.verify(hash, apiKey);
  } catch {
    return false;
  }
}
