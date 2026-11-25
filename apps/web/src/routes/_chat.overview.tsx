import { createFileRoute } from "@tanstack/react-router";

import { SovereignOverviewPage } from "../sovereign/SovereignOverviewPage";

export const Route = createFileRoute("/_chat/overview")({
  component: SovereignOverviewPage,
});
