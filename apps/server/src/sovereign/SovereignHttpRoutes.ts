import { IntegrationId } from "@t3tools/contracts";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import { requestUrl } from "../requestUrl.ts";
import * as SovereignIntegrationService from "./SovereignIntegrationService.ts";

const SOVEREIGN_WEBHOOK_ROUTE_PREFIX = "/api/sovereign/webhooks";
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: NO_STORE_HEADERS });

const handleSovereignWebhookRequest = Effect.fn(
  "SovereignHttpRoutes.handleSovereignWebhookRequest",
)(function* (integrations: SovereignIntegrationService.SovereignIntegrationService["Service"]) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const urlOpt = requestUrl(request);
  if (Option.isNone(urlOpt)) {
    return jsonResponse(400, { error: "invalid_url" });
  }

  const suffix = urlOpt.value.pathname.slice(`${SOVEREIGN_WEBHOOK_ROUTE_PREFIX}/`.length);
  const rawIntegrationId = decodeURIComponent(suffix.split("/", 1)[0] ?? "").trim();
  if (rawIntegrationId.length === 0) {
    return jsonResponse(404, { error: "integration_not_found" });
  }

  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return jsonResponse(413, { error: "body_too_large" });
  }

  const bodyOpt = yield* request.arrayBuffer.pipe(
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(MAX_WEBHOOK_BODY_BYTES)),
    Effect.option,
  );
  if (Option.isNone(bodyOpt) || bodyOpt.value.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return jsonResponse(413, { error: "body_too_large" });
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (typeof value === "string" && lower !== "cookie") {
      headers[lower] = value;
    }
  }

  const result = yield* integrations
    .handleInboundWebhook({
      integrationId: IntegrationId.make(rawIntegrationId),
      headers,
      rawBody: bodyOpt.value,
    })
    .pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Sovereign webhook processing failed", {
          integrationId: rawIntegrationId,
          cause,
        }).pipe(Effect.as({ outcome: "internal_error" as const })),
      ),
    );

  switch (result.outcome) {
    case "accepted":
      return jsonResponse(200, {
        status: "accepted",
        replayKey: result.replayKey,
        eventType: result.eventType,
        ledgerEntryId: result.ledgerEntryId,
      });
    case "duplicate":
      return jsonResponse(200, {
        status: "duplicate",
        replayKey: result.replayKey,
      });
    case "invalid_signature":
      return jsonResponse(401, { error: "invalid_signature" });
    case "not_found":
      return jsonResponse(404, { error: "integration_not_found" });
    case "disabled":
    case "unconfigured":
      return jsonResponse(409, { error: "integration_unavailable" });
    case "invalid_payload":
      return jsonResponse(400, { error: "invalid_payload", reason: result.reason });
    case "internal_error":
      return jsonResponse(500, { error: "internal_error" });
  }
});

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const integrations = yield* SovereignIntegrationService.SovereignIntegrationService;
    return HttpRouter.add(
      "POST",
      `${SOVEREIGN_WEBHOOK_ROUTE_PREFIX}/*`,
      handleSovereignWebhookRequest(integrations),
    );
  }),
);
