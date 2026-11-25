import { createFileRoute } from "@tanstack/react-router";

import { SovereignBudgetsSettingsPanel } from "../components/settings/SovereignBudgetsSettingsPanel";

export const Route = createFileRoute("/_chat/settings/budgets")({
  component: SovereignBudgetsSettingsPanel,
});
