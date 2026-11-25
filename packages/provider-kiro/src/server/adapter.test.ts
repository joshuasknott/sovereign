import { assert, describe, it } from "@effect/vitest";
import * as EffectAcpErrors from "effect-acp/errors";

import { kiroPromptFailure } from "./adapter.ts";

describe("kiroPromptFailure", () => {
  const nowMs = Date.parse("2026-10-20T10:00:00.000Z");

  it("classifies AWS ThrottlingException and 429 quota errors as usage_limit", () => {
    const throttled = kiroPromptFailure(
      new EffectAcpErrors.AcpRequestError({
        code: -32000,
        errorMessage:
          "ThrottlingException: Rate limit exceeded. Try again after 2026-10-20T10:15:00Z",
      }),
      nowMs,
    );
    assert.strictEqual(throttled.class, "usage_limit");
    assert.strictEqual(throttled.resetAt, "2026-10-20T10:15:00.000Z");

    const creditsOut = kiroPromptFailure(
      new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "HTTP 429: You have exhausted your monthly credit quota.",
      }),
      nowMs,
    );
    assert.strictEqual(creditsOut.class, "usage_limit");
  });

  it("preserves non-rate-limit Kiro prompt errors as provider_error", () => {
    const modelError = kiroPromptFailure(
      new EffectAcpErrors.AcpRequestError({
        code: -32000,
        errorMessage: "The model 'x' is not available. Please select a different model.",
      }),
      nowMs,
    );
    assert.strictEqual(modelError.class, "provider_error");
    assert.strictEqual(modelError.code, "-32000");
    assert.include(modelError.message, "not available");
  });
});
