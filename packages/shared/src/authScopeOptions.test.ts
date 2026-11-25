import {
  AuthGrantScope,
  AuthSovereignAdminScope,
  AuthSovereignApproveScope,
  AuthSovereignOperateScope,
  AuthSovereignReadScope,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { AUTH_SCOPE_OPTIONS, sessionPermissionsUnavailableMessage } from "./authScopeOptions.ts";

describe("AUTH_SCOPE_OPTIONS", () => {
  it("describes every grantable scope including Sovereign scopes", () => {
    const scopes = AUTH_SCOPE_OPTIONS.map((option) => option.scope);
    expect(scopes).toContain(AuthSovereignReadScope);
    expect(scopes).toContain(AuthSovereignOperateScope);
    expect(scopes).toContain(AuthSovereignApproveScope);
    expect(scopes).toContain(AuthSovereignAdminScope);
    expect(new Set(scopes)).toEqual(new Set(AuthGrantScope.literals));
  });
});

describe("sessionPermissionsUnavailableMessage", () => {
  it("asks to connect when the environment is disconnected", () => {
    expect(
      sessionPermissionsUnavailableMessage({ connected: false, failed: true, rejected: true }),
    ).toContain("Connect to this environment");
  });

  it("reports rejection before failure since retrying will not help", () => {
    expect(
      sessionPermissionsUnavailableMessage({ connected: true, failed: true, rejected: true }),
    ).toContain("did not accept your session");
  });

  it("reports a retrying failure while connected", () => {
    expect(
      sessionPermissionsUnavailableMessage({ connected: true, failed: true, rejected: false }),
    ).toContain("Retrying automatically");
  });

  it("shows a pending message when the check has not failed", () => {
    expect(
      sessionPermissionsUnavailableMessage({ connected: true, failed: false, rejected: false }),
    ).toContain("Checking permissions");
  });
});
