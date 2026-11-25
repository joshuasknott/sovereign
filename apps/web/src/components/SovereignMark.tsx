import type { SVGProps } from "react";

import { cn } from "../lib/utils";

export type SovereignMarkVariant = "monochrome" | "faceted";

export function SovereignMark({
  className,
  variant = "faceted",
  ...props
}: SVGProps<SVGSVGElement> & {
  readonly variant?: SovereignMarkVariant;
}) {
  return (
    <svg
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-5 shrink-0", className)}
      {...props}
    >
      <path d="M42 20H100L85 35H49L41 43L49 51H70L55 66H41L26 51V36L42 20Z" fill="currentColor" />
      <path d="M86 108H28L43 93H79L87 85L79 77H58L73 62H87L102 77V92L86 108Z" fill="currentColor" />
      <path
        d="M58 51H70L55 66H43L58 51Z"
        className={variant === "faceted" ? "fill-primary" : "fill-current opacity-60"}
      />
      <path
        d="M70 77H58L73 62H85L70 77Z"
        className={variant === "faceted" ? "fill-primary" : "fill-current opacity-60"}
      />
    </svg>
  );
}
