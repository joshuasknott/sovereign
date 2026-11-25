import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { recordPromptSent } from "./GitHubStarPrompt";

describe("recordPromptSent", () => {
  it("is disabled in Sovereign and resolves without prompting", async () => {
    await expect(recordPromptSent(EnvironmentId.make("environment-1"))).resolves.toBeUndefined();
  });
});
