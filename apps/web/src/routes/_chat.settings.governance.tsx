import { createFileRoute } from "@tanstack/react-router";

import { SovereignGovernanceSettingsPanel } from "../components/settings/SovereignGovernanceSettingsPanel";

export const Route = createFileRoute("/_chat/settings/governance")({
  component: SovereignGovernanceSettingsPanel,
});
