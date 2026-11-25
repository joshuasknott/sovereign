import { cn } from "../lib/utils";
import { SovereignMark, type SovereignMarkVariant } from "./SovereignMark";

export function SovereignWordmark({
  className,
  markClassName,
  variant = "faceted",
  showLabel = true,
}: {
  readonly className?: string;
  readonly markClassName?: string;
  readonly variant?: SovereignMarkVariant;
  readonly showLabel?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-foreground",
        className,
      )}
      role="img"
      aria-label="Sovereign"
    >
      <SovereignMark variant={variant} className={cn("size-4.5", markClassName)} aria-hidden />
      {showLabel ? <span className="truncate tracking-tight">Sovereign</span> : null}
    </span>
  );
}
