import { describe, expect, it } from "vite-plus/test";
import {
  BUILT_IN_THEME_IDS,
  BUILT_IN_THEMES,
  RESERVED_THEME_IDS,
  SOVEREIGN_THEME,
  THEME_COLOR_ROLES,
  getThemeColorsForAppearance,
} from "./themePalettes.ts";

function relativeLuminance(hex: string): number {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Expected 6-digit hex color, received ${hex}`);
  const channels = [match[1]!, match[2]!, match[3]!]
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(first: string, second: string): number {
  const l1 = relativeLuminance(first);
  const l2 = relativeLuminance(second);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe("Sovereign built-in theme preset", () => {
  it("registers Sovereign as a built-in reserved theme with dark and light variants", () => {
    expect(BUILT_IN_THEME_IDS).toContain("sovereign");
    expect(RESERVED_THEME_IDS.has("sovereign")).toBe(true);
    expect(BUILT_IN_THEMES.some((theme) => theme.id === "sovereign")).toBe(true);

    const dark = getThemeColorsForAppearance(SOVEREIGN_THEME, "dark");
    const light = getThemeColorsForAppearance(SOVEREIGN_THEME, "light");
    expect(dark).not.toBeNull();
    expect(light).not.toBeNull();
    for (const role of THEME_COLOR_ROLES) {
      expect(dark![role]).toBeTruthy();
      expect(light![role]).toBeTruthy();
    }
  });

  it.each(["dark", "light"] as const)(
    "meets WCAG AA+ contrast for %s Sovereign palette pairs",
    (appearance) => {
      const colors = getThemeColorsForAppearance(SOVEREIGN_THEME, appearance)!;
      const pairs: ReadonlyArray<readonly [string, string, string]> = [
        ["text on canvas", colors.text, colors.canvas],
        ["text on surface", colors.text, colors.surface],
        ["text on surfaceRaised", colors.text, colors.surfaceRaised],
        ["textMuted on canvas", colors.textMuted, colors.canvas],
        ["textMuted on surfaceRaised", colors.textMuted, colors.surfaceRaised],
        ["mutedForeground on muted", colors.mutedForeground, colors.muted],
        ["placeholder on input", colors.placeholder, colors.input],
        ["accentForeground on accent", colors.accentForeground, colors.accent],
        [
          "messageActionForeground on messageAction",
          colors.messageActionForeground,
          colors.messageAction,
        ],
        ["accent on canvas", colors.accent, colors.canvas],
        ["accent on surfaceRaised", colors.accent, colors.surfaceRaised],
        ["sidebarForeground on sidebar", colors.sidebarForeground, colors.sidebar],
        ["sidebarMutedForeground on sidebar", colors.sidebarMutedForeground, colors.sidebar],
        [
          "sidebarForeground on sidebarRowActive",
          colors.sidebarForeground,
          colors.sidebarRowActive,
        ],
        [
          "sidebarMutedForeground on sidebarRowActive",
          colors.sidebarMutedForeground,
          colors.sidebarRowActive,
        ],
        [
          "searchMatchForeground on searchMatchBackground",
          colors.searchMatchForeground,
          colors.searchMatchBackground,
        ],
        [
          "searchMatchActiveForeground on searchMatchActiveBackground",
          colors.searchMatchActiveForeground,
          colors.searchMatchActiveBackground,
        ],
        ["codeForeground on codeBackground", colors.codeForeground, colors.codeBackground],
        [
          "terminalForeground on terminalBackground",
          colors.terminalForeground,
          colors.terminalBackground,
        ],
      ];

      for (const [label, foreground, background] of pairs) {
        expect(
          contrastRatio(foreground, background),
          `${appearance}: ${label}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
