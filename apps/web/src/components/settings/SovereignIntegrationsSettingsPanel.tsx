import {
  IntegrationCategory,
  IntegrationProviderKind,
  type IntegrationConfig,
} from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { FlaskConicalIcon, PlugIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  INTEGRATION_CATEGORY_LABELS,
  INTEGRATION_PROVIDER_LABELS,
  INTEGRATION_STATUS_LABELS,
} from "../../sovereign/sovereignLabels";
import { formatShortTimestamp } from "../../sovereign/sovereignUi.logic";
import {
  sovereignCommands,
  useSovereignCommandPermission,
  useSovereignEnvironmentId,
  useSovereignIntegrations,
} from "../../state/sovereign";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const CATEGORY_FOR_PROVIDER: Record<IntegrationProviderKind, IntegrationCategory> = {
  stripe: "payments",
  paddle: "payments",
  lemonsqueezy: "payments",
  resend: "email",
  smtp: "email",
  twilio: "telephony_voice",
  vapi: "telephony_voice",
  retell: "telephony_voice",
  elevenlabs: "telephony_voice",
  github: "source_control",
  vercel: "hosting_deployment",
  cloudflare: "hosting_deployment",
  gumroad: "commerce",
  webhook: "webhook",
  custom: "custom",
};

export function SovereignIntegrationsSettingsPanel() {
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
  const environmentId = useSovereignEnvironmentId();
  const integrationsQuery = useSovereignIntegrations(
    environmentId,
    {},
    "settings-sovereign-integrations",
  );
  const canUpsert = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.upsertIntegrationCommand,
  );
  const canDelete = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.deleteIntegrationCommand,
  );
  const canTest = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.testIntegrationCommand,
  );

  const upsertIntegration = useAtomCommand(sovereignCommands.upsertIntegrationCommand, {
    label: "sovereign-upsert-integration",
  });
  const deleteIntegration = useAtomCommand(sovereignCommands.deleteIntegrationCommand, {
    label: "sovereign-delete-integration",
  });
  const testIntegration = useAtomCommand(sovereignCommands.testIntegrationCommand, {
    label: "sovereign-test-integration",
  });

  const [providerKind, setProviderKind] = useState<IntegrationProviderKind>("stripe");
  const [displayName, setDisplayName] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [sandboxMode, setSandboxMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleSave = async () => {
    if (environmentId === null || !canUpsert || saving || displayName.trim().length === 0) return;
    setSaving(true);
    const trimmedSecret = secretInput.trim();
    const result = await upsertIntegration({
      environmentId,
      input: {
        category: CATEGORY_FOR_PROVIDER[providerKind],
        providerKind,
        displayName: displayName.trim(),
        enabled: true,
        sandboxMode,
        ...(accountLabel.trim().length > 0 ? { accountLabel: accountLabel.trim() } : {}),
        ...(endpointUrl.trim().length > 0 ? { endpointUrl: endpointUrl.trim() } : {}),
        ...(trimmedSecret.length > 0 ? { secretValue: trimmedSecret } : {}),
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setDisplayName("");
      setAccountLabel("");
      setEndpointUrl("");
      setSecretInput("");
      toastManager.add({
        type: "success",
        title: gt("Integration saved"),
        description: result.value.displayName,
      });
    }
  };

  const handleTest = async (integration: IntegrationConfig) => {
    if (environmentId === null || !canTest || testingId !== null) return;
    setTestingId(integration.id);
    const result = await testIntegration({
      environmentId,
      input: { integrationId: integration.id },
    });
    setTestingId(null);
    if (result._tag === "Success") {
      toastManager.add({
        type: result.value.ok ? "success" : "error",
        title: result.value.ok ? gt("Connection verified") : gt("Connection check failed"),
        description: result.value.message,
      });
    }
  };

  const handleDelete = async (integration: IntegrationConfig) => {
    if (environmentId === null || !canDelete) return;
    const result = await deleteIntegration({
      environmentId,
      input: { integrationId: integration.id },
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "info",
        title: gt("Integration removed"),
        description: integration.displayName,
      });
    }
  };

  const integrations = integrationsQuery.data?.integrations ?? [];

  return (
    <SettingsPageContainer>
      {integrationsQuery.error ? (
        <Alert variant="error">
          <AlertTitle>
            <T>Could not load integrations</T>
          </AlertTitle>
          <AlertDescription>{integrationsQuery.error}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsSection
        {...searchableSetting("sovereign-integrations")}
        title={gt("Add Commercial Integration")}
      >
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted-foreground">
            <T>
              Connect payment, email, telephony, hosting, or commerce providers. Credentials are
              stored encrypted on the server and never returned in plaintext.
            </T>
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Select
              value={providerKind}
              onValueChange={(value) => {
                if (value) setProviderKind(value as IntegrationProviderKind);
              }}
            >
              <SelectTrigger size="sm" aria-label={gt("Integration provider")}>
                <SelectValue>{m(INTEGRATION_PROVIDER_LABELS[providerKind])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start">
                {IntegrationProviderKind.literals.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {m(INTEGRATION_PROVIDER_LABELS[kind])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <Input
              size="sm"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={gt("Label (e.g. Stripe UK Production)")}
              aria-label={gt("Integration label")}
            />

            <Input
              size="sm"
              value={accountLabel}
              onChange={(event) => setAccountLabel(event.target.value)}
              placeholder={gt("Account or sender (optional)")}
              aria-label={gt("Account label")}
            />

            <Input
              size="sm"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              placeholder={gt("Webhook or API URL (optional)")}
              aria-label={gt("Endpoint URL")}
            />
          </div>

          <Input
            size="sm"
            type="password"
            autoComplete="off"
            value={secretInput}
            onChange={(event) => setSecretInput(event.target.value)}
            placeholder={gt("API key or secret token (stored server-side only)")}
            aria-label={gt("API secret")}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={sandboxMode}
                onCheckedChange={(checked) => setSandboxMode(Boolean(checked))}
                aria-label={gt("Sandbox mode")}
              />
              <span>
                <T>Sandbox / test mode</T>
              </span>
            </label>

            <Button
              size="sm"
              disabled={
                environmentId === null || !canUpsert || saving || displayName.trim().length === 0
              }
              onClick={() => void handleSave()}
            >
              <PlusIcon className="size-3.5" />
              {saving ? <T>Saving…</T> : <T>Save integration</T>}
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={gt("Configured Integrations")}>
        {integrations.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            <T>
              No commercial integrations configured yet. Add Stripe, Resend, Vapi, Twilio, GitHub,
              Vercel, Cloudflare, or Gumroad above.
            </T>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {integrations.map((integration) => (
              <div
                key={integration.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PlugIcon className="size-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      {integration.displayName}
                    </span>
                    <Badge size="sm" variant="secondary">
                      {m(INTEGRATION_PROVIDER_LABELS[integration.providerKind])}
                    </Badge>
                    <Badge
                      size="sm"
                      variant={
                        integration.status === "connected"
                          ? "success"
                          : integration.status === "error"
                            ? "error"
                            : "outline"
                      }
                    >
                      {m(INTEGRATION_STATUS_LABELS[integration.status])}
                    </Badge>
                    {integration.sandboxMode ? (
                      <Badge size="sm" variant="warning">
                        <T>Sandbox</T>
                      </Badge>
                    ) : null}
                    {integration.hasSecret ? (
                      <Badge size="sm" variant="outline">
                        <T>Secret stored</T>
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    {integration.accountLabel ??
                      m(INTEGRATION_CATEGORY_LABELS[integration.category])}
                    {integration.lastTestedAt
                      ? ` · ${gt("Tested {time}", { time: formatShortTimestamp(integration.lastTestedAt) })}`
                      : ""}
                  </p>
                  {integration.lastError ? (
                    <p className="text-2xs text-destructive-foreground">{integration.lastError}</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canTest || testingId === integration.id}
                    onClick={() => void handleTest(integration)}
                  >
                    <FlaskConicalIcon className="size-3.5" />
                    {testingId === integration.id ? <T>Testing…</T> : <T>Test connection</T>}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost-destructive"
                    disabled={!canDelete}
                    aria-label={gt("Remove {name}", { name: integration.displayName })}
                    onClick={() => void handleDelete(integration)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
