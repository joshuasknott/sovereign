import { assert, describe, it } from "@effect/vitest";
import * as EffectAcpErrors from "effect-acp/errors";

import { classifyAcpPromptFailure } from "./adapter.ts";

describe("classifyAcpPromptFailure", () => {
  const nowMs = Date.parse("2026-10-20T10:00:00.000Z");

  it("maps HTTP 429 and rate-limit ACP request errors to usage_limit and parses ISO resetAt", () => {
    const failure = classifyAcpPromptFailure(
      new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "HTTP 429 Too Many Requests; quota resets at 2026-10-20T11:30:00.000Z",
      }),
      { nowMs, includeRequestMessage: true },
    );
    assert.strictEqual(failure.class, "usage_limit");
    assert.strictEqual(failure.retryable, true);
    assert.strictEqual(failure.resetAt, "2026-10-20T11:30:00.000Z");
  });

  it("maps structured ACP data retryAfterSeconds and numeric 429 codes to usage_limit", () => {
    const failure = classifyAcpPromptFailure(
      new EffectAcpErrors.AcpRequestError({
        code: -32029,
        errorMessage: "Request rejected",
        data: { retryAfterSeconds: 90 },
      }),
      { nowMs },
    );
    assert.strictEqual(failure.class, "usage_limit");
    assert.strictEqual(failure.resetAt, "2026-10-20T10:01:30.000Z");
  });

  it("maps RESOURCE_EXHAUSTED and Retry-After headers in messages to usage_limit", () => {
    const failure = classifyAcpPromptFailure(
      new EffectAcpErrors.AcpRequestError({
        code: -32000,
        errorMessage: "RESOURCE_EXHAUSTED: Retry-After: 2 minutes",
      }),
      { nowMs, includeRequestMessage: true },
    );
    assert.strictEqual(failure.class, "usage_limit");
    assert.strictEqual(failure.resetAt, "2026-10-20T10:02:00.000Z");
  });

  it("keeps ordinary ACP prompt errors as provider_error", () => {
    const failure = classifyAcpPromptFailure(
      new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Model not found",
      }),
      { nowMs, includeRequestMessage: true },
    );
    assert.strictEqual(failure.class, "provider_error");
    assert.strictEqual(failure.message, "Model not found");
    assert.isUndefined(failure.resetAt);
  });
});
