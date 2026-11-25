import { createFileRoute } from "@tanstack/react-router";

import { SovereignIntegrationsSettingsPanel } from "../components/settings/SovereignIntegrationsSettingsPanel";

export const Route = createFileRoute("/_chat/settings/sovereign-integrations")({
  component: SovereignIntegrationsSettingsPanel,
});
