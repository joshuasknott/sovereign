import type { IntegrationProviderKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type {
  SovereignIntegrationDriver,
  SovereignIntegrationService,
} from "../SovereignIntegrationService.ts";
import {
  createCloudflareDriver,
  createGumroadDriver,
  createVercelDriver,
} from "./deploymentDrivers.ts";
import { createResendDriver, createSmtpDriver } from "./emailDrivers.ts";
import { createGitHubDriver } from "./githubDriver.ts";
import { createFetchHttpTransport, type HttpTransport } from "./httpTransport.ts";
import {
  createLemonSqueezyDriver,
  createPaddleDriver,
  createStripeDriver,
} from "./paymentDrivers.ts";
import {
  createElevenLabsVoiceAdapter,
  createRetellVoiceAdapter,
  createTwilioVoiceAdapter,
  createVapiVoiceAdapter,
  type VoiceProviderAdapter,
  type VoiceProviderKind,
} from "./voiceDrivers.ts";

export interface BuiltInIntegrationDriverOptions {
  readonly transport?: HttpTransport;
  readonly nowUnixSeconds?: () => number;
}

export interface BuiltInIntegrationDrivers {
  readonly transport: HttpTransport;
  readonly drivers: ReadonlyArray<SovereignIntegrationDriver>;
  readonly byKind: ReadonlyMap<IntegrationProviderKind, SovereignIntegrationDriver>;
  readonly voiceAdapters: Readonly<Record<VoiceProviderKind, VoiceProviderAdapter>>;
}

export function createBuiltInIntegrationDrivers(
  options?: BuiltInIntegrationDriverOptions,
): BuiltInIntegrationDrivers {
  const transport = options?.transport ?? createFetchHttpTransport();
  const sharedTime =
    options?.nowUnixSeconds === undefined ? {} : { nowUnixSeconds: options.nowUnixSeconds };

  const vapi = createVapiVoiceAdapter({ transport });
  const retell = createRetellVoiceAdapter({ transport, ...sharedTime });
  const elevenlabs = createElevenLabsVoiceAdapter({ transport, ...sharedTime });
  const twilio = createTwilioVoiceAdapter({ transport });

  const drivers: ReadonlyArray<SovereignIntegrationDriver> = [
    createStripeDriver({ transport, ...sharedTime }),
    createPaddleDriver({ transport, ...sharedTime }),
    createLemonSqueezyDriver({ transport }),
    createResendDriver({ transport }),
    createSmtpDriver({ transport }),
    vapi.driver,
    retell.driver,
    elevenlabs.driver,
    twilio.driver,
    createGitHubDriver({ transport }),
    createVercelDriver({ transport }),
    createCloudflareDriver({ transport }),
    createGumroadDriver({ transport }),
  ];

  const byKind = new Map<IntegrationProviderKind, SovereignIntegrationDriver>();
  for (const driver of drivers) {
    byKind.set(driver.providerKind, driver);
  }

  return {
    transport,
    drivers,
    byKind,
    voiceAdapters: {
      vapi,
      retell,
      elevenlabs,
      twilio,
    },
  };
}

export const registerBuiltInIntegrationDrivers = Effect.fn(
  "SovereignIntegrations.registerBuiltInDrivers",
)(function* (
  integrationService: Pick<SovereignIntegrationService["Service"], "registerDriver">,
  options?: BuiltInIntegrationDriverOptions,
) {
  const builtIn = createBuiltInIntegrationDrivers(options);
  for (const driver of builtIn.drivers) {
    yield* integrationService.registerDriver(driver);
  }
  return builtIn;
});
