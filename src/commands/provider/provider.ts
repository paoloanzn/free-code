import type { LocalCommandCall } from "../../types/command.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { getAPIProvider } from "../../utils/model/providers.js";
import { refreshModelStringsForCurrentProvider } from "../../utils/model/modelStrings.js";
import { updateSettingsForSource } from "../../utils/settings/settings.js";

type ProviderName =
  | "firstParty"
  | "bedrock"
  | "vertex"
  | "foundry"
  | "openai"
  | "copilot";

const PROVIDER_ALIASES: Record<string, ProviderName> = {
  "first-party": "firstParty",
  firstparty: "firstParty",
  anthropic: "firstParty",
  bedrock: "bedrock",
  vertex: "vertex",
  foundry: "foundry",
  openai: "openai",
  copilot: "copilot",
  "github-copilot": "copilot",
};

function providerEnv(target: ProviderName): Record<string, string> {
  const base = {
    CLAUDE_CODE_USE_BEDROCK: "0",
    CLAUDE_CODE_USE_VERTEX: "0",
    CLAUDE_CODE_USE_FOUNDRY: "0",
    CLAUDE_CODE_USE_OPENAI: "0",
    CLAUDE_CODE_USE_COPILOT: "0",
  };

  switch (target) {
    case "bedrock":
      return { ...base, CLAUDE_CODE_USE_BEDROCK: "1" };
    case "vertex":
      return { ...base, CLAUDE_CODE_USE_VERTEX: "1" };
    case "foundry":
      return { ...base, CLAUDE_CODE_USE_FOUNDRY: "1" };
    case "openai":
      return { ...base, CLAUDE_CODE_USE_OPENAI: "1" };
    case "copilot":
      return { ...base, CLAUDE_CODE_USE_COPILOT: "1" };
    case "firstParty":
    default:
      return base;
  }
}

function providerDisplay(provider: ProviderName): string {
  switch (provider) {
    case "firstParty":
      return "first-party";
    default:
      return provider;
  }
}

function requiredVarsFor(provider: ProviderName): string[] {
  switch (provider) {
    case "bedrock":
      return ["AWS credentials or AWS_BEARER_TOKEN_BEDROCK"];
    case "vertex":
      return ["ANTHROPIC_VERTEX_PROJECT_ID and GCP credentials"];
    case "foundry":
      return ["ANTHROPIC_FOUNDRY_RESOURCE or ANTHROPIC_FOUNDRY_BASE_URL"];
    case "openai":
      return [
        "CLAUDE_CODE_OPENAI_API_KEY or OPENAI_API_KEY",
        "CLAUDE_CODE_OPENAI_BASE_URL or OPENAI_BASE_URL (optional)",
      ];
    case "copilot":
      return ["COPILOT_TOKEN (GitHub OAuth access token)"];
    case "firstParty":
    default:
      return ["ANTHROPIC_API_KEY or Claude.ai OAuth"];
  }
}

function hasProviderPrereqs(provider: ProviderName): boolean {
  switch (provider) {
    case "openai":
      return Boolean(
        process.env.CLAUDE_CODE_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      );
    case "copilot":
      return Boolean(process.env.COPILOT_TOKEN);
    case "vertex":
      return Boolean(process.env.ANTHROPIC_VERTEX_PROJECT_ID);
    case "foundry":
      return Boolean(
        process.env.ANTHROPIC_FOUNDRY_RESOURCE ||
        process.env.ANTHROPIC_FOUNDRY_BASE_URL,
      );
    case "bedrock":
      return Boolean(
        process.env.AWS_BEARER_TOKEN_BEDROCK ||
        process.env.AWS_PROFILE ||
        process.env.AWS_ACCESS_KEY_ID,
      );
    case "firstParty":
    default:
      return true;
  }
}

function parseProvider(raw: string): ProviderName | null {
  return PROVIDER_ALIASES[raw.toLowerCase()] ?? null;
}

function formatProviderStatus(): string {
  const provider = getAPIProvider();
  return (
    `Current provider: ${providerDisplay(provider)}\n` +
    `Set with /provider <name>. Available: first-party, bedrock, vertex, foundry, openai, copilot`
  );
}

function currentProviderFromEnv(): ProviderName {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) return "bedrock";
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)) return "vertex";
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)) return "foundry";
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_COPILOT)) return "copilot";
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)) return "openai";
  return "firstParty";
}

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "show" || trimmed === "status") {
    return { type: "text", value: formatProviderStatus() };
  }

  const parsed = parseProvider(trimmed);
  if (!parsed) {
    return {
      type: "text",
      value:
        `Unknown provider: ${trimmed}. ` +
        `Use one of: first-party, bedrock, vertex, foundry, openai, copilot`,
    };
  }

  const current = currentProviderFromEnv();
  if (current === parsed) {
    return {
      type: "text",
      value: `Provider already set to ${providerDisplay(parsed)}.`,
    };
  }

  const result = updateSettingsForSource("userSettings", {
    env: providerEnv(parsed),
  });
  if (result.error) {
    return {
      type: "text",
      value: `Failed to update provider settings: ${result.error.message}`,
    };
  }

  Object.assign(process.env, providerEnv(parsed));
  await refreshModelStringsForCurrentProvider();

  const requirements = requiredVarsFor(parsed).join("; ");
  const warning = hasProviderPrereqs(parsed)
    ? ""
    : `\nWarning: missing typical credentials/config for ${providerDisplay(parsed)} (${requirements}).`;

  return {
    type: "text",
    value:
      `Provider switched to ${providerDisplay(parsed)}.` +
      `\nModel picker now uses this provider.` +
      warning,
  };
};
