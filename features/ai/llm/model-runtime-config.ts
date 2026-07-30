export const AI_CONFIG = {
  defaultProvider: process.env.AI_DEFAULT_PROVIDER ?? "agnes",
  defaultModel: process.env.AI_DEFAULT_MODEL ?? "agnes-2.5-flash",
  rolloutPercent: parseInt(process.env.AI_GATEWAY_ROLLOUT_PERCENT ?? "0"),
  gatewayBaseUrl: process.env.AI_GATEWAY_BASE_URL,
} as const;
