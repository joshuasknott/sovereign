# Sovereign Brand Assets

Master vector sources for Sovereign's architectural Dual-Plane Meridian identity live in three channel folders:

- `prod/` — Production (Obsidian `#090A0D`–`#191C24`, Warm Ivory `#FAF8F3`–`#E5DFD3`, Brushed Champagne `#C8A97E`)
- `nightly/` — Nightly / Preview (Nocturne Obsidian `#0A0911`–`#1B1926`, Warm Ivory, Muted Amber-Ochre `#D2964F`)
- `dev/` — Development (Blueprint Slate-Obsidian `#080E14`–`#13212A`, Crisp Titanium `#F2F7F8`, Mineral Slate-Teal `#62AEB7`)

Each channel folder contains:

- `icon.svg`: canonical 1024×1024 squircle master used for iOS, Linux/universal, Windows `.ico`, and web favicons/manifests
- `icon-macos.svg`: canonical 1024×1024 macOS desktop icon with classic 824×824 safe area inset 100px per side and elevation shadow
- `app-icon.icon/`: Apple Icon Composer layered project (`icon.json` + `Assets/*.svg`) kept in sync with the vector masters

`prod/logo.svg` is the standalone monochrome (`currentColor`) Dual-Plane Meridian emblem.

## Exporting and checking icons

Run `vp run icons:export` from the repository root to regenerate all tracked PNG and ICO renditions across `assets/{dev,nightly,prod}` and copy the development web icons into `apps/web/public`. Run `vp run icons:check` to verify byte-for-byte that every generated icon matches its master SVG without modifying files. Both commands run cross-platform using `sharp` (no macOS-only `ictool` required).

## Android launcher and splash artwork

Android adaptive launchers mask the central 72dp of a 108dp canvas and Android 12+ splash screens mask the central two-thirds of a 288dp canvas. Run `vp run icons:export:android` to regenerate all Android adaptive foreground, full-bleed backgrounds, splash screens, monochrome themed icon (`android-icon-mark.png`), and status-bar notification icon (`android-notification-icon.png`) directly from the layered SVGs in `assets/{prod,dev,nightly}/app-icon.icon/Assets/`.
