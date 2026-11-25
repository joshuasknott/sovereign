import type { VentureKind } from "@t3tools/contracts";
import {
  AudioLines,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  CodeXml,
  Layers2,
  PanelsTopLeft,
  ShieldCheck,
} from "lucide-react";

const marks = {
  web_agency: Layers2,
  digital_products: Boxes,
  custom: BookOpen,
  micro_saas: PanelsTopLeft,
  voice_ai: AudioLines,
  dev_bounties: CodeXml,
  security_bounties: ShieldCheck,
  paid_tasks: BriefcaseBusiness,
} satisfies Record<VentureKind, typeof BookOpen>;

export function VentureMark({ kind, className }: { kind: VentureKind; className?: string }) {
  const Icon = marks[kind];
  return <Icon aria-hidden="true" className={className} />;
}
