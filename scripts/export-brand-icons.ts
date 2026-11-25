#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import sharp from "sharp";

import { BRAND_ASSET_PATHS, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./lib/brand-assets.ts";
import { encodePngIco, readPngDimensions, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

const SVG_DENSITY = 144;

interface VariantOutputs {
  readonly ios: string;
  readonly macos: string;
  readonly universal: string;
  readonly appleTouch: string;
  readonly webIcon192: string;
  readonly webIcon512: string;
  readonly favicon16: string;
  readonly favicon32: string;
  readonly faviconIco: string;
  readonly windowsIco: string;
}

interface IconVariant {
  readonly label: string;
  readonly source: string;
  readonly macosSource: string;
  readonly outputs: VariantOutputs;
}

class IconExportFileSystemError extends Schema.TaggedError<IconExportFileSystemError>()(
  "IconExportFileSystemError",
  {
    operation: Schema.Literals([
      "resolve-repository-root",
      "check-path",
      "read-file",
      "make-directory",
      "make-temp-file",
      "write-file",
      "rename-file",
    ]),
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Icon export file-system operation '${this.operation}' failed for ${this.path}.`;
  }
}

class IconExportSourceMissingError extends Schema.TaggedError<IconExportSourceMissingError>()(
  "IconExportSourceMissingError",
  {
    sourcePath: Schema.String,
  },
) {
  override get message(): string {
    return `Missing master SVG icon source: ${this.sourcePath}`;
  }
}

class IconExportRenditionError extends Schema.TaggedError<IconExportRenditionError>()(
  "IconExportRenditionError",
  {
    sourcePath: Schema.String,
    expectedSize: Schema.Int,
    actualWidth: Schema.optional(Schema.Int),
    actualHeight: Schema.optional(Schema.Int),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const actual =
      this.actualWidth === undefined || this.actualHeight === undefined
        ? "an invalid PNG"
        : `${this.actualWidth}x${this.actualHeight}`;
    return `SVG rasterization produced ${actual}; expected ${this.expectedSize}x${this.expectedSize} for ${this.sourcePath}.`;
  }
}

class IconExportEncodingError extends Schema.TaggedError<IconExportEncodingError>()(
  "IconExportEncodingError",
  {
    variant: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to encode ICO renditions for the ${this.variant} icon.`;
  }
}

class IconExportAssetsStaleError extends Schema.TaggedError<IconExportAssetsStaleError>()(
  "IconExportAssetsStaleError",
  {
    paths: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Generated icon assets are stale:\n${this.paths.map((path) => `- ${path}`).join("\n")}`;
  }
}

const ICON_VARIANTS = [
  {
    label: "development",
    source: BRAND_ASSET_PATHS.developmentIconSvg,
    macosSource: BRAND_ASSET_PATHS.developmentMacIconSvg,
    outputs: {
      ios: BRAND_ASSET_PATHS.developmentIosIconPng,
      macos: BRAND_ASSET_PATHS.developmentDesktopIconPng,
      universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
      appleTouch: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
      webIcon192: BRAND_ASSET_PATHS.developmentWebIcon192Png,
      webIcon512: BRAND_ASSET_PATHS.developmentWebIcon512Png,
      favicon16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
      favicon32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
      faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
      windowsIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
    },
  },
  {
    label: "nightly",
    source: BRAND_ASSET_PATHS.nightlyIconSvg,
    macosSource: BRAND_ASSET_PATHS.nightlyMacIconSvg,
    outputs: {
      ios: BRAND_ASSET_PATHS.nightlyIosIconPng,
      macos: BRAND_ASSET_PATHS.nightlyMacIconPng,
      universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      appleTouch: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
      webIcon192: BRAND_ASSET_PATHS.nightlyWebIcon192Png,
      webIcon512: BRAND_ASSET_PATHS.nightlyWebIcon512Png,
      favicon16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
      favicon32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
      faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      windowsIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    },
  },
  {
    label: "production",
    source: BRAND_ASSET_PATHS.productionIconSvg,
    macosSource: BRAND_ASSET_PATHS.productionMacIconSvg,
    outputs: {
      ios: BRAND_ASSET_PATHS.productionIosIconPng,
      macos: BRAND_ASSET_PATHS.productionMacIconPng,
      universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
      appleTouch: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
      webIcon192: BRAND_ASSET_PATHS.productionWebIcon192Png,
      webIcon512: BRAND_ASSET_PATHS.productionWebIcon512Png,
      favicon16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
      favicon32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
      faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
      windowsIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    },
  },
] as const satisfies ReadonlyArray<IconVariant>;

const RepositoryRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
  Effect.mapError(
    (cause) =>
      new IconExportFileSystemError({
        operation: "resolve-repository-root",
        path: new URL("..", import.meta.url).pathname,
        cause,
      }),
  ),
);

const readRequiredSource = Effect.fn("iconExport.readRequiredSource")(function* (
  repositoryRoot: string,
  relativePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fullPath = path.join(repositoryRoot, relativePath);
  const exists = yield* fs.exists(fullPath).pipe(
    Effect.mapError(
      (cause) =>
        new IconExportFileSystemError({
          operation: "check-path",
          path: fullPath,
          cause,
        }),
    ),
  );
  if (!exists) {
    return yield* new IconExportSourceMissingError({ sourcePath: relativePath });
  }
  const contents = yield* fs.readFile(fullPath).pipe(
    Effect.mapError(
      (cause) =>
        new IconExportFileSystemError({
          operation: "read-file",
          path: fullPath,
          cause,
        }),
    ),
  );
  return Buffer.from(contents);
});

const renderSvgSize = Effect.fn("iconExport.renderSvgSize")(function* (
  sourcePath: string,
  svg: Buffer,
  size: number,
) {
  const buffer = yield* Effect.tryPromise({
    try: () =>
      sharp(svg, { density: SVG_DENSITY })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    catch: (cause) =>
      new IconExportRenditionError({
        sourcePath,
        expectedSize: size,
        cause,
      }),
  });
  const dimensions = yield* Effect.try({
    try: () => readPngDimensions(buffer),
    catch: (cause) =>
      new IconExportRenditionError({
        sourcePath,
        expectedSize: size,
        cause,
      }),
  });
  if (dimensions.width !== size || dimensions.height !== size) {
    return yield* new IconExportRenditionError({
      sourcePath,
      expectedSize: size,
      actualWidth: dimensions.width,
      actualHeight: dimensions.height,
    });
  }
  return buffer;
});

const renderVariant = Effect.fn("iconExport.renderVariant")(function* (
  repositoryRoot: string,
  variant: IconVariant,
) {
  const iconSvg = yield* readRequiredSource(repositoryRoot, variant.source);
  const macosSvg = yield* readRequiredSource(repositoryRoot, variant.macosSource);

  const renditionCache = new Map<number, Buffer>();
  const render = Effect.fn("iconExport.renderVariant.rendition")(function* (size: number) {
    const cached = renditionCache.get(size);
    if (cached) return cached;
    const contents = yield* renderSvgSize(variant.source, iconSvg, size);
    renditionCache.set(size, contents);
    return contents;
  });

  const ios = yield* render(1024);
  const macos = yield* renderSvgSize(variant.macosSource, macosSvg, 1024);
  const icoRenditions = yield* Effect.forEach(
    WINDOWS_ICON_SIZES,
    (size) => render(size).pipe(Effect.map((contents) => ({ size, contents }))),
    { concurrency: 1 },
  );
  const ico = yield* Effect.try({
    try: () => encodePngIco(icoRenditions),
    catch: (cause) => new IconExportEncodingError({ variant: variant.label, cause }),
  });

  return new Map<string, Buffer>([
    [variant.outputs.ios, ios],
    [variant.outputs.macos, macos],
    [variant.outputs.universal, ios],
    [variant.outputs.appleTouch, yield* render(180)],
    [variant.outputs.webIcon192, yield* render(192)],
    [variant.outputs.webIcon512, yield* render(512)],
    [variant.outputs.favicon16, yield* render(16)],
    [variant.outputs.favicon32, yield* render(32)],
    [variant.outputs.faviconIco, ico],
    [variant.outputs.windowsIco, ico],
  ]);
});

const writeAtomically = Effect.fn("iconExport.writeAtomically")(function* (
  repositoryRoot: string,
  relativePath: string,
  contents: Buffer,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const targetPath = path.join(repositoryRoot, relativePath);
  const targetDirectory = path.dirname(targetPath);
  yield* fs.makeDirectory(targetDirectory, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new IconExportFileSystemError({
          operation: "make-directory",
          path: targetDirectory,
          cause,
        }),
    ),
  );
  const temporaryPath = yield* fs
    .makeTempFileScoped({
      directory: targetDirectory,
      prefix: ".sovereign-icon-export-",
      suffix: ".tmp",
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new IconExportFileSystemError({
            operation: "make-temp-file",
            path: targetDirectory,
            cause,
          }),
      ),
    );
  yield* fs.writeFile(temporaryPath, contents).pipe(
    Effect.mapError(
      (cause) =>
        new IconExportFileSystemError({
          operation: "write-file",
          path: temporaryPath,
          cause,
        }),
    ),
  );
  yield* fs.rename(temporaryPath, targetPath).pipe(
    Effect.mapError(
      (cause) =>
        new IconExportFileSystemError({
          operation: "rename-file",
          path: targetPath,
          cause,
        }),
    ),
  );
});

const isCurrent = Effect.fn("iconExport.isCurrent")(function* (
  repositoryRoot: string,
  relativePath: string,
  expected: Buffer,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const targetPath = path.join(repositoryRoot, relativePath);
  const exists = yield* fs.exists(targetPath).pipe(
    Effect.mapError(
      (cause) =>
        new IconExportFileSystemError({
          operation: "check-path",
          path: targetPath,
          cause,
        }),
    ),
  );
  if (!exists) return false;

  const actual = yield* fs.readFile(targetPath).pipe(
    Effect.mapError(
      (cause) =>
        new IconExportFileSystemError({
          operation: "read-file",
          path: targetPath,
          cause,
        }),
    ),
  );
  return Buffer.from(actual).equals(expected);
});

const exportBrandIcons = Effect.fn("exportBrandIcons")(function* (checkOnly: boolean) {
  const repositoryRoot = yield* RepositoryRoot;
  const generated = new Map<string, Buffer>();
  for (const variant of ICON_VARIANTS) {
    yield* Console.log(`Rendering ${variant.label} from ${variant.source}...`);
    const variantAssets = yield* renderVariant(repositoryRoot, variant);
    for (const [relativePath, contents] of variantAssets) {
      generated.set(relativePath, contents);
    }
  }

  for (const override of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
    const sourceContents = generated.get(override.sourceRelativePath);
    if (sourceContents === undefined) {
      return yield* Effect.die(
        new Error(`Generated development web icon is missing: ${override.sourceRelativePath}`),
      );
    }
    generated.set(override.targetRelativePath, sourceContents);
  }

  if (checkOnly) {
    const stale = yield* Effect.filter(
      [...generated.entries()],
      ([relativePath, contents]) =>
        isCurrent(repositoryRoot, relativePath, contents).pipe(Effect.map((current) => !current)),
      { concurrency: "unbounded" },
    );
    if (stale.length > 0) {
      return yield* new IconExportAssetsStaleError({
        paths: stale.map(([relativePath]) => relativePath),
      });
    }
    yield* Console.log(`All ${generated.size} generated icon assets are current.`);
    return;
  }

  yield* Effect.forEach(
    generated,
    ([relativePath, contents]) => writeAtomically(repositoryRoot, relativePath, contents),
    { concurrency: 1, discard: true },
  );
  yield* Console.log(`Updated ${generated.size} generated icon assets.`);
});

const exportBrandIconsCommand = Command.make(
  "export-brand-icons",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("Verify generated icon assets without modifying files."),
      Flag.withDefault(false),
    ),
  },
  ({ check }) => exportBrandIcons(check).pipe(Effect.scoped),
).pipe(
  Command.withDescription(
    "Export development, nightly, and production icon assets from Sovereign master SVGs.",
  ),
);

if (import.meta.main) {
  Command.run(exportBrandIconsCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
