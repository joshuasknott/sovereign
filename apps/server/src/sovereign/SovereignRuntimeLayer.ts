import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { registerBuiltInIntegrationDrivers } from "./integrations/registerBuiltInDrivers.ts";
import * as SovereignGovernanceService from "./SovereignGovernanceService.ts";
import * as SovereignIntegrationService from "./SovereignIntegrationService.ts";
import * as SovereignLedgerService from "./SovereignLedgerService.ts";
import * as SovereignOrchestratorService from "./SovereignOrchestratorService.ts";
import * as SovereignSalesService from "./SovereignSalesService.ts";
import * as SovereignStore from "./SovereignStore.ts";
import * as VentureWorkflowEngine from "./ventures/VentureWorkflowEngine.ts";

const layerGovernance = SovereignGovernanceService.layer.pipe(
  Layer.provideMerge(SovereignStore.layer),
);

const layerLedgerAndSales = Layer.mergeAll(
  SovereignLedgerService.layer,
  SovereignSalesService.layer,
).pipe(Layer.provideMerge(layerGovernance));

const layerIntegrations = SovereignIntegrationService.layer.pipe(
  Layer.provideMerge(layerLedgerAndSales),
);

const layerBuiltInIntegrationDrivers = Layer.effectDiscard(
  Effect.gen(function* () {
    const integrations = yield* SovereignIntegrationService.SovereignIntegrationService;
    yield* registerBuiltInIntegrationDrivers(integrations);
  }),
).pipe(Layer.provideMerge(layerIntegrations));

const layerOrchestrator = SovereignOrchestratorService.layer.pipe(
  Layer.provideMerge(layerBuiltInIntegrationDrivers),
);

export const layer = VentureWorkflowEngine.layer.pipe(Layer.provideMerge(layerOrchestrator));

export const layerStartupRecovery = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrator = yield* SovereignOrchestratorService.SovereignOrchestratorService;
    const summary = yield* orchestrator.recoverInterruptedWork;
    if (summary.recoveredTaskIds.length > 0 || summary.failedTaskIds.length > 0) {
      yield* Effect.logInfo("Sovereign startup task recovery completed", {
        recovered: summary.recoveredTaskIds.length,
        failed: summary.failedTaskIds.length,
      });
    }
  }),
);
