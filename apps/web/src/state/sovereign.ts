import { createSovereignAtoms } from "@t3tools/client-runtime/sovereign/atoms";
import { createSovereignCommands } from "@t3tools/client-runtime/sovereign/commands";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  SovereignListApprovalsInput,
  SovereignListAuditEventsInput,
  SovereignListIntegrationsInput,
  SovereignListLedgerEntriesInput,
  VentureId,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironments, usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentQuery } from "./query";

const sovereignAtoms = createSovereignAtoms(connectionAtomRuntime);
export const sovereignCommands = createSovereignCommands(connectionAtomRuntime);

const INERT_SUBSCRIPTION_ATOM = Atom.make<null>(null).pipe(
  Atom.withLabel("web-sovereign:inert-subscription"),
);

const FALSE_PERMISSION_ATOM = Atom.make(false).pipe(
  Atom.withLabel("web-sovereign:false-permission"),
);

export function useSovereignEnvironmentId(): EnvironmentId | null {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  if (primaryEnvironmentId !== null) return primaryEnvironmentId;
  const connected = environments.find((env) => env.connection.phase === "connected");
  return connected?.environmentId ?? environments[0]?.environmentId ?? null;
}

export function useSovereignLiveSubscription(environmentId: EnvironmentId | null): void {
  useAtomValue(
    environmentId !== null
      ? sovereignAtoms.sovereignEventsSubscriptionAtomFamily(environmentId)
      : INERT_SUBSCRIPTION_ATOM,
  );
}

export function useSovereignCommandPermission(
  environmentId: EnvironmentId | null,
  command: { readonly permissionAtom: (environmentId: EnvironmentId) => Atom.Atom<boolean> },
): boolean {
  return useAtomValue(
    environmentId !== null ? command.permissionAtom(environmentId) : FALSE_PERMISSION_ATOM,
  );
}

export function useSovereignOverview(environmentId: EnvironmentId | null, mountScope?: string) {
  return useEnvironmentQuery(
    environmentId !== null
      ? sovereignAtoms.sovereignOverviewAtomFamily(environmentId, mountScope)
      : null,
  );
}

export function useSovereignVentureDetail(
  environmentId: EnvironmentId | null,
  ventureId: VentureId | null,
  mountScope?: string,
) {
  return useEnvironmentQuery(
    environmentId !== null && ventureId !== null
      ? sovereignAtoms.sovereignVentureDetailAtomFamily(environmentId, ventureId, mountScope)
      : null,
  );
}

export function useSovereignBlueprints(environmentId: EnvironmentId | null, mountScope?: string) {
  return useEnvironmentQuery(
    environmentId !== null
      ? sovereignAtoms.sovereignBlueprintsAtomFamily(environmentId, mountScope)
      : null,
  );
}

export function useSovereignProviderPool(environmentId: EnvironmentId | null, mountScope?: string) {
  return useEnvironmentQuery(
    environmentId !== null
      ? sovereignAtoms.sovereignProviderPoolAtomFamily(environmentId, mountScope)
      : null,
  );
}

export function useSovereignIntegrations(
  environmentId: EnvironmentId | null,
  input?: SovereignListIntegrationsInput,
  mountScope?: string,
) {
  return useEnvironmentQuery(
    environmentId !== null
      ? sovereignAtoms.sovereignIntegrationsAtomFamily(environmentId, input, mountScope)
      : null,
  );
}

export function useSovereignApprovals(
  environmentId: EnvironmentId | null,
  input?: SovereignListApprovalsInput,
  mountScope?: string,
) {
  return useEnvironmentQuery(
    environmentId !== null
      ? sovereignAtoms.sovereignApprovalsAtomFamily(environmentId, input, mountScope)
      : null,
  );
}

export function useSovereignLedger(
  environmentId: EnvironmentId | null,
  input?: SovereignListLedgerEntriesInput,
  mountScope?: string,
) {
  return useEnvironmentQuery(
    environmentId !== null
      ? sovereignAtoms.sovereignLedgerAtomFamily(environmentId, input, mountScope)
      : null,
  );
}

export function useSovereignAuditEvents(
  environmentId: EnvironmentId | null,
  input?: SovereignListAuditEventsInput,
  mountScope?: string,
) {
  return useEnvironmentQuery(
    environmentId !== null
      ? sovereignAtoms.sovereignAuditEventsAtomFamily(environmentId, input, mountScope)
      : null,
  );
}
