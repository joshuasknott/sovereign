import { assert, describe, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  SecretProviderId,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@t3tools/contracts";

import {
  billingClassCostRank,
  classifyProviderInstanceBilling,
  defaultRoutingPriorityForBillingClass,
  isPaidMeteredClass,
} from "./billingClassifier.ts";

function makeSnapshot(
  overrides: Partial<Omit<ServerProvider, "driver">> & { readonly driver: string },
): ServerProvider {
  const { driver: rawDriver, ...rest } = overrides;
  const driver = ProviderDriverKind.make(rawDriver);
  return {
    instanceId: rest.instanceId ?? ProviderInstanceId.make(rawDriver),
    driver,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-01T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...rest,
  };
}

describe("classifyProviderInstanceBilling", () => {
  it("respects explicit user pool.billingClass override first", () => {
    const config: ProviderInstanceConfig = {
      driver: ProviderDriverKind.make("codex"),
      environment: [{ name: "OPENAI_API_KEY", value: "sk-test", sensitive: true }],
      pool: { billingClass: "manual_only" },
    };
    assert.strictEqual(
      classifyProviderInstanceBilling(config, makeSnapshot({ driver: "codex" })),
      "manual_only",
    );

    const opencodeLocal: ProviderInstanceConfig = {
      driver: ProviderDriverKind.make("opencode"),
      pool: { billingClass: "local" },
    };
    assert.strictEqual(classifyProviderInstanceBilling(opencodeLocal), "local");
  });

  it("classifies Codex managed/ChatGPT auth as subscription and API key or Bedrock as metered_api", () => {
    assert.strictEqual(
      classifyProviderInstanceBilling(
        { driver: ProviderDriverKind.make("codex"), config: { setupMode: "managed" } },
        makeSnapshot({
          driver: "codex",
          auth: { status: "authenticated", type: "chatgpt", label: "ChatGPT Plus Subscription" },
        }),
      ),
      "subscription",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling(
        {
          driver: ProviderDriverKind.make("codex"),
          environment: [{ name: "OPENAI_API_KEY", value: "sk-live-key", sensitive: true }],
        },
        makeSnapshot({ driver: "codex" }),
      ),
      "metered_api",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling(
        {
          driver: ProviderDriverKind.make("codex"),
          environment: [
            {
              name: "OPENAI_API_KEY",
              value: {
                provider: SecretProviderId.make("op"),
                reference: "op://vault/openai/key",
              },
              sensitive: true,
            },
          ],
        },
        makeSnapshot({ driver: "codex" }),
      ),
      "metered_api",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling(
        { driver: ProviderDriverKind.make("codex") },
        makeSnapshot({
          driver: "codex",
          auth: { status: "authenticated", type: "amazonBedrock", label: "Amazon Bedrock" },
        }),
      ),
      "metered_api",
    );
  });

  it("classifies Claude OAuth as subscription and API key, auth token, or Bedrock as metered_api", () => {
    assert.strictEqual(
      classifyProviderInstanceBilling(
        { driver: ProviderDriverKind.make("claudeAgent") },
        makeSnapshot({
          driver: "claudeAgent",
          auth: { status: "authenticated", type: "max", label: "Claude Max Subscription" },
        }),
      ),
      "subscription",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("claudeAgent"),
        environment: [
          { name: "ANTHROPIC_API_KEY", value: "", sensitive: true, valueRedacted: true },
        ],
      }),
      "metered_api",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("claudeAgent"),
        environment: [{ name: "ANTHROPIC_AUTH_TOKEN", value: "tok-123", sensitive: true }],
      }),
      "metered_api",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("claudeAgent"),
        environment: [{ name: "CLAUDE_CODE_USE_BEDROCK", value: "1", sensitive: false }],
      }),
      "metered_api",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("claudeAgent"),
        environment: [{ name: "CLAUDE_CODE_USE_BEDROCK", value: "0", sensitive: false }],
      }),
      "subscription",
    );
  });

  it("classifies Antigravity OAuth methods as subscription and API key or agent-platform as metered_api", () => {
    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("antigravity"),
        config: { authMethod: "oauth-personal" },
      }),
      "subscription",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("antigravity"),
        config: { authMethod: "oauth-business" },
      }),
      "subscription",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("antigravity"),
        config: { authMethod: "gemini-api-key" },
      }),
      "metered_api",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("antigravity"),
        config: { authMethod: "agent-platform" },
      }),
      "metered_api",
    );
  });

  it("classifies Cursor and Grok OAuth/cached logins as subscription and explicit API keys as metered_api", () => {
    assert.strictEqual(
      classifyProviderInstanceBilling(
        { driver: ProviderDriverKind.make("cursor") },
        makeSnapshot({
          driver: "cursor",
          auth: { status: "authenticated", type: "browser", label: "Cursor account" },
        }),
      ),
      "subscription",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("cursor"),
        environment: [{ name: "CURSOR_API_KEY", value: "cur-key", sensitive: true }],
      }),
      "metered_api",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling(
        { driver: ProviderDriverKind.make("grok") },
        makeSnapshot({
          driver: "grok",
          auth: { status: "authenticated", type: "cached_token", label: "Grok account" },
        }),
      ),
      "subscription",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("grok"),
        environment: [{ name: "XAI_API_KEY", value: "xai-key", sensitive: true }],
      }),
      "metered_api",
    );
  });

  it("classifies devReplay as free and local endpoints or local ACP as local", () => {
    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("acpRegistry"),
        config: {
          source: "local",
          commandPath: "/usr/bin/node",
          commandArgs: ["/repo/apps/server/scripts/dev-replay-agent.ts"],
        },
      }),
      "free",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("opencode"),
        environment: [{ name: "OLLAMA_HOST", value: "http://127.0.0.1:11434", sensitive: false }],
      }),
      "local",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("pi"),
        config: { baseUrl: "http://localhost:1234/v1" },
      }),
      "local",
    );

    assert.strictEqual(
      classifyProviderInstanceBilling({
        driver: ProviderDriverKind.make("acpRegistry"),
        config: { source: "local", commandPath: "/usr/local/bin/my-local-agent" },
      }),
      "local",
    );
  });

  it("classifies ambiguous aggregators without explicit config conservatively as unknown", () => {
    for (const driver of ["opencode", "pi", "fx", "kiro", "acpRegistry"]) {
      assert.strictEqual(
        classifyProviderInstanceBilling({ driver: ProviderDriverKind.make(driver) }),
        "unknown",
        `Expected ${driver} to default to unknown`,
      );
    }
  });

  it("treats metered_api and unknown as paid and orders default priorities cleanly", () => {
    assert.isTrue(isPaidMeteredClass("metered_api"));
    assert.isTrue(isPaidMeteredClass("unknown"));
    assert.isFalse(isPaidMeteredClass("free"));
    assert.isFalse(isPaidMeteredClass("local"));
    assert.isFalse(isPaidMeteredClass("subscription"));

    assert.isAbove(
      defaultRoutingPriorityForBillingClass("free"),
      defaultRoutingPriorityForBillingClass("local"),
    );
    assert.isAbove(
      defaultRoutingPriorityForBillingClass("local"),
      defaultRoutingPriorityForBillingClass("subscription"),
    );
    assert.isAbove(
      defaultRoutingPriorityForBillingClass("subscription"),
      defaultRoutingPriorityForBillingClass("metered_api"),
    );
    assert.isBelow(billingClassCostRank("free"), billingClassCostRank("subscription"));
    assert.isBelow(billingClassCostRank("subscription"), billingClassCostRank("metered_api"));
  });
});
