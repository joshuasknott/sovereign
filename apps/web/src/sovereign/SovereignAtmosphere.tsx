import type { ReactNode } from "react";

import { cn } from "../lib/utils";

export type SovereignAtmosphereVariant = "expressive" | "quiet";

export function SovereignAtmosphere({
  variant = "expressive",
  className,
  children,
}: {
  readonly variant?: SovereignAtmosphereVariant;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "sovereign-atmosphere-canvas relative isolate flex min-h-0 min-w-0 flex-1 flex-col",
        className,
      )}
      data-sovereign-surface={variant}
    >
      <div aria-hidden="true" className="sovereign-atmosphere-layer" />
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
