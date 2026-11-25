import { VentureId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { SovereignVenturePage } from "../sovereign/SovereignVenturePage";

function VentureRouteView() {
  const { ventureId } = Route.useParams();
  return <SovereignVenturePage ventureId={VentureId.make(ventureId)} />;
}

export const Route = createFileRoute("/_chat/ventures/$ventureId")({
  component: VentureRouteView,
});
