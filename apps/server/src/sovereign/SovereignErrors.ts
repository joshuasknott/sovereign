import {
  ApprovalRequestId,
  SovereignError,
  type SovereignErrorCode,
  VentureId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export class SovereignPersistenceError extends Schema.TaggedError<SovereignPersistenceError>()(
  "SovereignPersistenceError",
  {
    operation: Schema.String,
    entity: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} sovereign ${this.entity}.`;
  }
}

export class SovereignNotFoundError extends Schema.TaggedError<SovereignNotFoundError>()(
  "SovereignNotFoundError",
  {
    entity: Schema.String,
    id: Schema.String,
  },
) {
  override get message(): string {
    return `Sovereign ${this.entity} "${this.id}" was not found.`;
  }
}

export class SovereignValidationError extends Schema.TaggedError<SovereignValidationError>()(
  "SovereignValidationError",
  {
    field: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid ${this.field}: ${this.reason}`;
  }
}

export class SovereignConflictError extends Schema.TaggedError<SovereignConflictError>()(
  "SovereignConflictError",
  {
    entity: Schema.String,
    id: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `Conflict updating ${this.entity} "${this.id}": ${this.reason}`;
  }
}

export const SovereignPermissionErrorCode = Schema.Literals([
  "permission_denied",
  "emergency_stop_active",
  "budget_exceeded",
  "paid_fallback_denied",
  "security_unauthorised",
  "consent_required",
]);
export type SovereignPermissionErrorCode = typeof SovereignPermissionErrorCode.Type;

export class SovereignPermissionError extends Schema.TaggedError<SovereignPermissionError>()(
  "SovereignPermissionError",
  {
    code: SovereignPermissionErrorCode,
    reason: Schema.String,
    ventureId: Schema.optionalKey(VentureId),
    approvalId: Schema.optionalKey(ApprovalRequestId),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export class SovereignIntegrationError extends Schema.TaggedError<SovereignIntegrationError>()(
  "SovereignIntegrationError",
  {
    integrationId: Schema.String,
    stage: Schema.String,
    reason: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Integration ${this.integrationId} failed during ${this.stage}: ${this.reason}`;
  }
}

export type SovereignDomainError =
  | SovereignPersistenceError
  | SovereignNotFoundError
  | SovereignValidationError
  | SovereignConflictError
  | SovereignPermissionError
  | SovereignIntegrationError;

export function toSovereignRpcError(error: SovereignDomainError): SovereignError {
  switch (error._tag) {
    case "SovereignNotFoundError":
      return new SovereignError({ code: "not_found", message: error.message });
    case "SovereignValidationError":
      return new SovereignError({ code: "invalid_input", message: error.message });
    case "SovereignConflictError":
      return new SovereignError({ code: "conflict", message: error.message });
    case "SovereignPermissionError":
      return new SovereignError({
        code: error.code as SovereignErrorCode,
        message: error.message,
        ...(error.ventureId === undefined ? {} : { ventureId: error.ventureId }),
        ...(error.approvalId === undefined ? {} : { approvalId: error.approvalId }),
      });
    case "SovereignIntegrationError":
      return new SovereignError({ code: "integration_unavailable", message: error.message });
    case "SovereignPersistenceError":
      return new SovereignError({ code: "internal", message: error.message });
  }
}
