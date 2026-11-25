import { describe, expect, it } from "vite-plus/test";

import {
  formatAppDisplayName,
  resolveWebAppStageLabel,
  resolveWindowTitle,
} from "./branding.logic";

describe("branding.logic", () => {
  it("formats Sovereign display names with and without stage labels", () => {
    expect(formatAppDisplayName({ baseName: "Sovereign", stageLabel: "Latest" })).toBe("Sovereign");
    expect(formatAppDisplayName({ baseName: "Sovereign", stageLabel: "Dev" })).toBe(
      "Sovereign (Dev)",
    );
  });

  it("resolves web stage labels", () => {
    expect(resolveWebAppStageLabel({ hostedAppChannel: "nightly", development: false })).toBe(
      "Nightly",
    );
    expect(resolveWebAppStageLabel({ hostedAppChannel: "", development: true })).toBe("Dev");
    expect(resolveWebAppStageLabel({ hostedAppChannel: "", development: false })).toBe("Latest");
    expect(
      formatAppDisplayName({
        baseName: "Sovereign",
        stageLabel: resolveWebAppStageLabel({ hostedAppChannel: "", development: false }),
      }),
    ).toBe("Sovereign");
  });

  it("resolves Sovereign window titles cleanly", () => {
    expect(
      resolveWindowTitle({
        appDisplayName: "Sovereign",
        projectTitle: null,
        threadTitle: null,
        desktop: false,
      }),
    ).toBe("Sovereign");
  });
});
