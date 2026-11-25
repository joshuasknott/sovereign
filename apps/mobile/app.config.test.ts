import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ APP_VARIANT: process.env.APP_VARIANT }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "Sovereign", "com.sovereign.app"],
  ["development", "Sovereign Dev", "com.sovereign.app.dev"],
  ["preview", "Sovereign Preview", "com.sovereign.app.preview"],
  ["production", "Sovereign", "com.sovereign.app"],
])(
  "uses Sovereign iOS and Android identifiers for APP_VARIANT=%j without T3 Tools credentials",
  async (value, expectedName, identifier) => {
    const config = await loadConfig(value);
    expect(config.name).toBe(expectedName);
    expect(config.slug).toBe("sovereign");
    expect(config.owner).toBeUndefined();
    expect(config.ios?.bundleIdentifier).toBe(identifier);
    expect(config.ios?.appleTeamId).toBeUndefined();
    expect(config.ios?.associatedDomains).toBeUndefined();
    expect(config.android?.package).toBe(identifier);
    expect(config.android?.intentFilters).toBeUndefined();
    expect(config.updates?.url).toBeUndefined();
    expect(config.updates?.enabled).toBe(false);
    expect(config.extra?.eas?.projectId).toBeUndefined();
    expect(appleAppSiteAssociation.applinks.details).toEqual([]);
    expect(assetLinks).toEqual([]);
  },
);
