#!/usr/bin/env node

// Android masks a 72dp safe area inside 108dp; full-bleed backgrounds and safe-framed emblems avoid double silhouettes/cropping.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

type IconVariant = "dev" | "nightly" | "prod";

const ADAPTIVE_CANVAS = 432;
const SPLASH_CANVAS = 1152;
const NOTIFICATION_CANVAS = 96;
const MARK_BOUNDS = { x: 26, y: 20, width: 76, height: 88 };
const ADAPTIVE_MARK_FRACTION = 0.44;
const NOTIFICATION_MARK_FRACTION = 0.68;
const SVG_DENSITY = 300;
const OUTPUT_DIRECTORY = "apps/mobile/assets";

class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

const markTransform = (size: number, fraction: number) => {
  const scale = (size * fraction) / MARK_BOUNDS.height;
  const tx = (size - MARK_BOUNDS.width * scale) / 2 - MARK_BOUNDS.x * scale;
  const ty = (size - MARK_BOUNDS.height * scale) / 2 - MARK_BOUNDS.y * scale;
  return `translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(4)})`;
};

const canvasSvg = (size: number, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">${inner}</svg>`;

// Remove the iOS 10pt corner clip; Android's own mask needs full bleed.
const fullBleed = (svg: string) =>
  svg.replace(/<rect width="128" height="128" rx="10"\/>/, '<rect width="128" height="128"/>');

const extractDefsAndBody = (svg: string) => {
  const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? "";
  const body = svg
    .replace(/^<svg[^>]*>/, "")
    .replace(/<defs>[\s\S]*?<\/defs>/, "")
    .replace(/<\/svg>\s*$/, "")
    .trim();
  return { defs, body };
};

const rasterize = (layer: string, svg: string, width: number, height = width) =>
  Effect.tryPromise({
    try: () =>
      sharp(Buffer.from(svg), { density: SVG_DENSITY })
        .resize(width, height)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const composite = (
  layer: string,
  base: Buffer,
  overlays: ReadonlyArray<{ input: Buffer; left?: number; top?: number }>,
) =>
  Effect.tryPromise({
    try: () =>
      sharp(base)
        .composite([...overlays])
        .png({ compressionLevel: 9 })
        .toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const readLayerSource = Effect.fn("androidIcons.readLayerSource")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.readFileString(
    path.join(repositoryRoot, "assets", variant, "app-icon.icon", "Assets", file),
  );
});

const renderForeground = Effect.fn("androidIcons.renderForeground")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  size: number,
) {
  const emblem = yield* readLayerSource(repositoryRoot, variant, "text.svg");
  const { defs, body } = extractDefsAndBody(emblem);
  return yield* rasterize(
    `${variant}-foreground`,
    canvasSvg(
      size,
      `${defs}<g transform="${markTransform(size, ADAPTIVE_MARK_FRACTION)}">${body}</g>`,
    ),
    size,
  );
});

const renderMonochromeMark = Effect.fn("androidIcons.renderMonochromeMark")(function* (
  repositoryRoot: string,
  size: number,
  fraction: number,
  layer: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const logo = yield* fs.readFileString(path.join(repositoryRoot, "assets", "prod", "logo.svg"));
  const { body } = extractDefsAndBody(logo);
  const whiteBody = body.replaceAll('fill="currentColor"', 'fill="#FFFFFF"');
  return yield* rasterize(
    layer,
    canvasSvg(size, `<g transform="${markTransform(size, fraction)}">${whiteBody}</g>`),
    size,
  );
});

const renderDevelopmentBackground = Effect.fn("androidIcons.renderDevelopmentBackground")(
  function* (repositoryRoot: string, size: number) {
    const paper = yield* readLayerSource(repositoryRoot, "dev", "background.svg");
    const annotations = yield* readLayerSource(repositoryRoot, "dev", "annotations.svg");
    const background = yield* rasterize("dev-background", fullBleed(paper), size);
    const overlay = yield* rasterize("dev-annotations", annotations, size);
    return yield* composite("dev-background", background, [{ input: overlay }]);
  },
);

const renderBackground = Effect.fn("androidIcons.renderBackground")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  size: number,
) {
  if (variant === "dev") {
    return yield* renderDevelopmentBackground(repositoryRoot, size);
  }
  const source = yield* readLayerSource(repositoryRoot, variant, "background.svg");
  return yield* rasterize(`${variant}-background`, fullBleed(source), size);
});

const renderSplashIcon = Effect.fn("androidIcons.renderSplashIcon")(function* (
  repositoryRoot: string,
  variant: IconVariant,
) {
  const background = yield* renderBackground(repositoryRoot, variant, SPLASH_CANVAS);
  const foreground = yield* renderForeground(repositoryRoot, variant, SPLASH_CANVAS);
  return yield* composite(`${variant}-splash`, background, [{ input: foreground }]);
});

const exportAndroidIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const outputs = [
    [
      "android-icon-foreground.png",
      yield* renderForeground(repositoryRoot, "prod", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-background-dev.png",
      yield* renderDevelopmentBackground(repositoryRoot, ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-background-nightly.png",
      yield* renderBackground(repositoryRoot, "nightly", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-mark.png",
      yield* renderMonochromeMark(
        repositoryRoot,
        ADAPTIVE_CANVAS,
        ADAPTIVE_MARK_FRACTION,
        "android-mark",
      ),
    ],
    [
      "android-notification-icon.png",
      yield* renderMonochromeMark(
        repositoryRoot,
        NOTIFICATION_CANVAS,
        NOTIFICATION_MARK_FRACTION,
        "android-notification",
      ),
    ],
    ["android-splash-icon-dev.png", yield* renderSplashIcon(repositoryRoot, "dev")],
    ["android-splash-icon-nightly.png", yield* renderSplashIcon(repositoryRoot, "nightly")],
    ["android-splash-icon-prod.png", yield* renderSplashIcon(repositoryRoot, "prod")],
  ] as const;
  for (const [name, contents] of outputs) {
    yield* fs.writeFile(path.join(repositoryRoot, OUTPUT_DIRECTORY, name), contents);
    yield* Console.log(`wrote ${OUTPUT_DIRECTORY}/${name}`);
  }
});

if (import.meta.main) {
  exportAndroidIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
