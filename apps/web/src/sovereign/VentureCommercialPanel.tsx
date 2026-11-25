import {
  AiPermissionStatus,
  AutomationMode,
  ConsentChannel,
  DEFAULT_REPORTING_CURRENCY,
  OpportunityStage,
  VoiceAgentDirection,
  type EnvironmentId,
  type Opportunity,
  type SovereignVentureDetail,
} from "@t3tools/contracts";
import {
  formatCompositeScore,
  formatMinorCurrency,
} from "@t3tools/client-runtime/sovereign/format";
import { T, useGT, useMessages } from "gt-react";
import {
  BotIcon,
  LockIcon,
  MailIcon,
  PhoneCallIcon,
  PlusIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { toastManager } from "../components/ui/toast";
import { sovereignCommands, useSovereignCommandPermission } from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";
import {
  AI_PERMISSION_STATUS_LABELS,
  AUTOMATION_MODE_LABELS,
  CONSENT_CHANNEL_LABELS,
  ELIGIBILITY_STATUS_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  VOICE_AGENT_DIRECTION_LABELS,
} from "./sovereignLabels";
import {
  formatShortTimestamp,
  isSecurityAuthorised,
  parseMajorCurrencyToMinor,
  splitPaidTaskOpportunities,
  summarizeLeadConsent,
} from "./sovereignUi.logic";

function OpportunitiesTable({
  environmentId,
  opportunities,
  canUpdate,
  onStageChange,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly opportunities: ReadonlyArray<Opportunity>;
  readonly canUpdate: boolean;
  readonly onStageChange: (opportunity: Opportunity, nextStage: OpportunityStage) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  if (opportunities.length === 0) {
    return (
      <p className="px-4 py-6 text-xs text-muted-foreground">
        <T>No opportunities tracked in this bucket yet.</T>
      </p>
    );
  }
  return (
    <div className="divide-y divide-border/70">
      {opportunities.map((opp) => (
        <div
          key={opp.id}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">{opp.title}</span>
              <Badge
                size="sm"
                variant={
                  opp.aiPermissionStatus === "permitted"
                    ? "success"
                    : opp.aiPermissionStatus === "prohibited"
                      ? "error"
                      : "secondary"
                }
              >
                {m(AI_PERMISSION_STATUS_LABELS[opp.aiPermissionStatus])}
              </Badge>
              <Badge
                size="sm"
                variant={
                  opp.eligibilityStatus === "eligible"
                    ? "success"
                    : opp.eligibilityStatus === "ineligible"
                      ? "error"
                      : "warning"
                }
              >
                {m(ELIGIBILITY_STATUS_LABELS[opp.eligibilityStatus])}
              </Badge>
              {opp.score ? (
                <Badge size="sm" variant="outline">
                  {formatCompositeScore(opp.score.overall)}
                </Badge>
              ) : null}
            </div>
            <p className="text-2xs text-muted-foreground">
              {opp.source}
              {opp.sourceUrl ? ` · ${opp.sourceUrl}` : ""}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {opp.estimatedValueMinor !== null ? (
              <span className="font-mono font-medium text-foreground tabular-nums">
                {formatMinorCurrency(opp.estimatedValueMinor, opp.currency)}
              </span>
            ) : null}
            <div className="w-36">
              <Select
                value={opp.stage}
                disabled={environmentId === null || !canUpdate}
                onValueChange={(value) => {
                  if (value) onStageChange(opp, value as OpportunityStage);
                }}
              >
                <SelectTrigger size="sm" aria-label={gt("Stage for {title}", { title: opp.title })}>
                  <SelectValue>{m(OPPORTUNITY_STAGE_LABELS[opp.stage])}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end">
                  {OpportunityStage.literals.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {m(OPPORTUNITY_STAGE_LABELS[stage])}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VentureCommercialPanel({
  environmentId,
  detail,
  onOpenPolicyConfig,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly detail: SovereignVentureDetail;
  readonly onOpenPolicyConfig: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { venture } = detail;

  // Opportunity form state
  const [oppTitle, setOppTitle] = useState("");
  const [oppSource, setOppSource] = useState("");
  const [oppValueInput, setOppValueInput] = useState("");
  const [oppAiStatus, setOppAiStatus] = useState<AiPermissionStatus>("permitted");
  const [oppAutoMode, setOppAutoMode] = useState<AutomationMode>("assisted");
  const [submittingOpp, setSubmittingOpp] = useState(false);

  // Lead & Proposal & Communication state (Web Agency / Sales)
  const [leadName, setLeadName] = useState("");
  const [leadCompany, setLeadCompany] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadConsentGranted, setLeadConsentGranted] = useState(true);
  const [submittingLead, setSubmittingLead] = useState(false);

  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalAmountInput, setProposalAmountInput] = useState("");
  const [submittingProposal, setSubmittingProposal] = useState(false);

  const [commSubject, setCommSubject] = useState("");
  const [commPreview, setCommPreview] = useState("");
  const [commChannel, setCommChannel] = useState<ConsentChannel>("email");
  const [commAiDisclosed, setCommAiDisclosed] = useState(true);
  const [submittingComm, setSubmittingComm] = useState(false);

  // Voice Agent state
  const [voiceName, setVoiceName] = useState("");
  const [voiceDirection, setVoiceDirection] = useState<VoiceAgentDirection>("inbound");
  const [voiceGreeting, setVoiceGreeting] = useState(
    gt(
      "Hello, you are speaking with an AI assistant acting on behalf of this business. This call may be recorded.",
    ),
  );
  const [voiceEscalation, setVoiceEscalation] = useState("");
  const [voiceRecordingDisclosure, setVoiceRecordingDisclosure] = useState(true);
  const [voiceOptOutEnabled, setVoiceOptOutEnabled] = useState(true);
  const [submittingVoice, setSubmittingVoice] = useState(false);

  const canCreateOpp = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createOpportunityCommand,
  );
  const canUpdateOpp = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.updateOpportunityCommand,
  );
  const canCreateLead = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createLeadCommand,
  );
  const canCreateProposal = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createProposalCommand,
  );
  const canCreateComm = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createCommunicationCommand,
  );
  const canUpsertVoice = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.upsertVoiceAgentCommand,
  );

  const createOpp = useAtomCommand(sovereignCommands.createOpportunityCommand, {
    label: "sovereign-create-opportunity",
  });
  const updateOpp = useAtomCommand(sovereignCommands.updateOpportunityCommand, {
    label: "sovereign-update-opportunity",
  });
  const createLead = useAtomCommand(sovereignCommands.createLeadCommand, {
    label: "sovereign-create-lead",
  });
  const createProposal = useAtomCommand(sovereignCommands.createProposalCommand, {
    label: "sovereign-create-proposal",
  });
  const createComm = useAtomCommand(sovereignCommands.createCommunicationCommand, {
    label: "sovereign-create-communication",
  });
  const upsertVoiceAgent = useAtomCommand(sovereignCommands.upsertVoiceAgentCommand, {
    label: "sovereign-upsert-voice-agent",
  });

  const handleAddOpportunity = async () => {
    if (environmentId === null || !canCreateOpp || submittingOpp || oppTitle.trim().length === 0) {
      return;
    }
    const parsedMinor =
      oppValueInput.trim().length > 0 ? parseMajorCurrencyToMinor(oppValueInput) : null;
    setSubmittingOpp(true);
    const result = await createOpp({
      environmentId,
      input: {
        ventureId: venture.id,
        title: oppTitle.trim(),
        source: oppSource.trim() || venture.kind,
        aiPermissionStatus: oppAiStatus,
        automationMode: oppAutoMode,
        currency: venture.budgetPolicy.currency,
        ...(parsedMinor !== null ? { estimatedValueMinor: parsedMinor } : {}),
      },
    });
    setSubmittingOpp(false);
    if (result._tag === "Success") {
      setOppTitle("");
      setOppSource("");
      setOppValueInput("");
      toastManager.add({
        type: "success",
        title: gt("Opportunity added"),
        description: result.value.title,
      });
    }
  };

  const handleStageChange = (opp: Opportunity, nextStage: OpportunityStage) => {
    if (environmentId === null || !canUpdateOpp) return;
    void updateOpp({
      environmentId,
      input: {
        opportunityId: opp.id,
        stage: nextStage,
      },
    });
  };

  const handleAddLead = async () => {
    if (
      environmentId === null ||
      !canCreateLead ||
      submittingLead ||
      leadName.trim().length === 0
    ) {
      return;
    }
    setSubmittingLead(true);
    const result = await createLead({
      environmentId,
      input: {
        ventureId: venture.id,
        name: leadName.trim(),
        source: "manual",
        ...(leadCompany.trim().length > 0 ? { company: leadCompany.trim() } : {}),
        ...(leadEmail.trim().length > 0 ? { email: leadEmail.trim() } : {}),
        consents: [
          {
            channel: "email",
            status: leadConsentGranted ? "granted" : "pending",
            lawfulBasis: leadConsentGranted ? "consent" : "not_established",
            optedOut: false,
            optedOutAt: null,
            consentCapturedAt: leadConsentGranted ? new Date().toISOString() : null,
            aiDisclosureGiven: true,
            recordingDisclosureGiven: false,
            jurisdiction: "UK",
          },
        ],
      },
    });
    setSubmittingLead(false);
    if (result._tag === "Success") {
      setLeadName("");
      setLeadCompany("");
      setLeadEmail("");
      toastManager.add({
        type: "success",
        title: gt("Prospect added"),
        description: result.value.name,
      });
    }
  };

  const handleCreateProposal = async () => {
    const amountMinor = parseMajorCurrencyToMinor(proposalAmountInput);
    if (
      environmentId === null ||
      !canCreateProposal ||
      submittingProposal ||
      proposalTitle.trim().length === 0 ||
      amountMinor === null ||
      amountMinor <= 0
    ) {
      return;
    }
    setSubmittingProposal(true);
    const result = await createProposal({
      environmentId,
      input: {
        ventureId: venture.id,
        title: proposalTitle.trim(),
        currency: venture.budgetPolicy.currency,
        lineItems: [
          {
            description: proposalTitle.trim(),
            quantity: 1,
            unitAmountMinor: amountMinor,
          },
        ],
      },
    });
    setSubmittingProposal(false);
    if (result._tag === "Success") {
      setProposalTitle("");
      setProposalAmountInput("");
      toastManager.add({
        type: "success",
        title: gt("Proposal queued"),
        description: result.value.title,
      });
    }
  };

  const handleLogCommunication = async () => {
    if (
      environmentId === null ||
      !canCreateComm ||
      submittingComm ||
      commPreview.trim().length === 0
    ) {
      return;
    }
    setSubmittingComm(true);
    const result = await createComm({
      environmentId,
      input: {
        ventureId: venture.id,
        channel: commChannel,
        direction: "outbound",
        senderType: "ai_agent",
        aiDisclosed: commAiDisclosed,
        consentVerified: true,
        ...(commSubject.trim().length > 0 ? { subject: commSubject.trim() } : {}),
        bodyPreview: commPreview.trim(),
      },
    });
    setSubmittingComm(false);
    if (result._tag === "Success") {
      setCommSubject("");
      setCommPreview("");
      toastManager.add({
        type: "success",
        title: gt("Communication recorded"),
        description: gt("Disclosed AI outbound item logged for policy review."),
      });
    }
  };

  const handleUpsertVoiceAgent = async () => {
    if (
      environmentId === null ||
      !canUpsertVoice ||
      submittingVoice ||
      voiceName.trim().length === 0 ||
      voiceGreeting.trim().length === 0
    ) {
      return;
    }
    setSubmittingVoice(true);
    const result = await upsertVoiceAgent({
      environmentId,
      input: {
        ventureId: venture.id,
        name: voiceName.trim(),
        direction: voiceDirection,
        status: "draft",
        aiDisclosureGreeting: voiceGreeting.trim(),
        recordingDisclosureEnabled: voiceRecordingDisclosure,
        optOutPhraseEnabled: voiceOptOutEnabled,
        ...(voiceEscalation.trim().length > 0
          ? { escalationNumberLabel: voiceEscalation.trim() }
          : {}),
      },
    });
    setSubmittingVoice(false);
    if (result._tag === "Success") {
      setVoiceName("");
      toastManager.add({
        type: "success",
        title: gt("Voice agent configured"),
        description: result.value.name,
      });
    }
  };

  const securityAuthorised = isSecurityAuthorised(venture);
  const { automatedPermitted, humanRequired } = splitPaidTaskOpportunities(detail.opportunities);

  return (
    <div className="space-y-6">
      {venture.kind === "security_bounties" ? (
        <Alert variant={securityAuthorised ? "success" : "warning"}>
          {securityAuthorised ? (
            <ShieldCheckIcon className="size-4" />
          ) : (
            <LockIcon className="size-4" />
          )}
          <AlertTitle>
            {securityAuthorised ? (
              <T>Security Testing Scope: AUTHORISED</T>
            ) : (
              <T>Security Testing Scope: LOCKED</T>
            )}
          </AlertTitle>
          <AlertDescription>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {securityAuthorised
                  ? gt(
                      "Authorised programme: {programme}. Scope targets: {count}. Non-destructive verification only.",
                      {
                        programme:
                          venture.permissionPolicy.securityAuthorisation.programmeName ??
                          gt("Configured scope"),
                        count: venture.permissionPolicy.securityAuthorisation.targetScope.length,
                      },
                    )
                  : gt(
                      "Active security testing is blocked by default until you record an authorised bug bounty programme, explicit target scope, and disclosure policy.",
                    )}
              </span>
              <Button size="xs" variant="outline" onClick={onOpenPolicyConfig}>
                {securityAuthorised ? <T>Review Scope Lock</T> : <T>Configure Authorisation</T>}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {venture.kind === "voice_ai" ? (
        <>
          <Alert variant="info">
            <PhoneCallIcon className="size-4" />
            <AlertTitle>
              <T>Telephony &amp; Voice Marginal Cost Guardrail</T>
            </AlertTitle>
            <AlertDescription>
              <T>
                Voice minutes and TTS incur direct carrier charges. Ensure your venture budget cap
                and Vapi, Retell, ElevenLabs, or Twilio credentials are configured in Settings
                before activating live calls.
              </T>
            </AlertDescription>
          </Alert>

          <section
            aria-label={gt("Voice Agents")}
            className="rounded-xl border border-border/80 bg-card/80"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <BotIcon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  <T>Voice Agents</T>
                </h2>
              </div>
              <Badge size="sm" variant="secondary">
                {detail.voiceAgents.length}
              </Badge>
            </div>

            <div className="space-y-3 border-b border-border/70 bg-muted/20 p-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Input
                  size="sm"
                  value={voiceName}
                  onChange={(event) => setVoiceName(event.target.value)}
                  placeholder={gt("Agent name (e.g. Inbound Booking Desk)")}
                  aria-label={gt("Voice agent name")}
                />
                <Select
                  value={voiceDirection}
                  onValueChange={(value) => {
                    if (value) setVoiceDirection(value as VoiceAgentDirection);
                  }}
                >
                  <SelectTrigger size="sm" aria-label={gt("Call direction")}>
                    <SelectValue>{m(VOICE_AGENT_DIRECTION_LABELS[voiceDirection])}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="start">
                    {VoiceAgentDirection.literals.map((dir) => (
                      <SelectItem key={dir} value={dir}>
                        {m(VOICE_AGENT_DIRECTION_LABELS[dir])}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Input
                  size="sm"
                  value={voiceEscalation}
                  onChange={(event) => setVoiceEscalation(event.target.value)}
                  placeholder={gt("Human escalation number (optional)")}
                  aria-label={gt("Escalation number")}
                />
              </div>
              <Input
                size="sm"
                value={voiceGreeting}
                onChange={(event) => setVoiceGreeting(event.target.value)}
                placeholder={gt("Mandatory AI and call-recording disclosure greeting")}
                aria-label={gt("AI disclosure greeting")}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <label className="inline-flex items-center gap-2">
                    <Switch
                      checked={voiceRecordingDisclosure}
                      onCheckedChange={(checked) => setVoiceRecordingDisclosure(Boolean(checked))}
                      aria-label={gt("Recording disclosure enabled")}
                    />
                    <span>
                      <T>Recording disclosure</T>
                    </span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <Switch
                      checked={voiceOptOutEnabled}
                      onCheckedChange={(checked) => setVoiceOptOutEnabled(Boolean(checked))}
                      aria-label={gt("Opt-out phrase enabled")}
                    />
                    <span>
                      <T>Immediate opt-out honouring</T>
                    </span>
                  </label>
                </div>
                <Button
                  size="sm"
                  disabled={
                    !canUpsertVoice ||
                    submittingVoice ||
                    voiceName.trim().length === 0 ||
                    voiceGreeting.trim().length === 0
                  }
                  onClick={() => void handleUpsertVoiceAgent()}
                >
                  <PlusIcon className="size-3.5" />
                  <T>Save voice agent</T>
                </Button>
              </div>
            </div>

            {detail.voiceAgents.length === 0 ? (
              <p className="px-4 py-6 text-xs text-muted-foreground">
                <T>No voice agents configured yet.</T>
              </p>
            ) : (
              <div className="divide-y divide-border/70">
                {detail.voiceAgents.map((agent) => (
                  <div key={agent.id} className="space-y-1.5 px-4 py-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{agent.name}</span>
                        <Badge size="sm" variant="secondary">
                          {m(VOICE_AGENT_DIRECTION_LABELS[agent.direction])}
                        </Badge>
                        <Badge
                          size="sm"
                          variant={agent.status === "active" ? "success" : "outline"}
                        >
                          {agent.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {agent.recordingDisclosureEnabled ? (
                          <Badge size="sm" variant="success">
                            <T>Recording Disclosed</T>
                          </Badge>
                        ) : null}
                        {agent.optOutPhraseEnabled ? (
                          <Badge size="sm" variant="outline">
                            <T>Opt-out Active</T>
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-muted-foreground">{agent.aiDisclosureGreeting}</p>
                    {agent.escalationNumberLabel ? (
                      <p className="text-2xs text-muted-foreground">
                        {gt("Escalates to: {target}", { target: agent.escalationNumberLabel })}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {venture.kind === "paid_tasks" ? (
        <div className="space-y-6">
          <section className="rounded-xl border border-border/80 bg-card/80">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                <T>Automated-Permitted Tasks</T>
              </h2>
              <Badge size="sm" variant="success">
                {automatedPermitted.length}
              </Badge>
            </div>
            <OpportunitiesTable
              environmentId={environmentId}
              opportunities={automatedPermitted}
              canUpdate={canUpdateOpp}
              onStageChange={handleStageChange}
            />
          </section>

          <section className="rounded-xl border border-border/80 bg-card/80">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                <T>Human-Required Opportunities</T>
              </h2>
              <Badge size="sm" variant="warning">
                {humanRequired.length}
              </Badge>
            </div>
            <OpportunitiesTable
              environmentId={environmentId}
              opportunities={humanRequired}
              canUpdate={canUpdateOpp}
              onStageChange={handleStageChange}
            />
          </section>
        </div>
      ) : null}

      {venture.kind !== "web_agency" && venture.kind !== "voice_ai" ? (
        <section
          aria-label={gt("Opportunities Pipeline")}
          className="rounded-xl border border-border/80 bg-card/80"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              {venture.kind === "dev_bounties" ? (
                <T>Bounties &amp; Pull Requests</T>
              ) : venture.kind === "security_bounties" ? (
                <T>Programmes &amp; Findings</T>
              ) : venture.kind === "paid_tasks" ? (
                <T>Add Paid Task Opportunity</T>
              ) : (
                <T>Validated Opportunities</T>
              )}
            </h2>
            {venture.kind === "micro_saas" ? (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {gt("MRR: {amount}", {
                  amount: formatMinorCurrency(
                    detail.financialSummary.monthlyRecurringRevenueMinor,
                    detail.financialSummary.reportingCurrency,
                  ),
                })}
              </span>
            ) : null}
          </div>

          <div className="space-y-2 border-b border-border/70 bg-muted/20 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
              <div className="sm:col-span-6">
                <Input
                  size="sm"
                  value={oppTitle}
                  onChange={(event) => setOppTitle(event.target.value)}
                  placeholder={gt("Opportunity or bounty title")}
                  aria-label={gt("Opportunity title")}
                />
              </div>
              <div className="sm:col-span-4">
                <Input
                  size="sm"
                  value={oppSource}
                  onChange={(event) => setOppSource(event.target.value)}
                  placeholder={gt("Source (GitHub)")}
                  aria-label={gt("Opportunity source")}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  size="sm"
                  inputMode="decimal"
                  value={oppValueInput}
                  onChange={(event) => setOppValueInput(event.target.value)}
                  placeholder={gt("Est. ({currency})", { currency: venture.budgetPolicy.currency })}
                  aria-label={gt("Estimated value")}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="w-full sm:w-44">
                <Select
                  value={oppAiStatus}
                  onValueChange={(value) => {
                    if (value) setOppAiStatus(value as AiPermissionStatus);
                  }}
                >
                  <SelectTrigger size="sm" aria-label={gt("AI policy status")}>
                    <SelectValue>{m(AI_PERMISSION_STATUS_LABELS[oppAiStatus])}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end">
                    {AiPermissionStatus.literals.map((status) => (
                      <SelectItem key={status} value={status}>
                        {m(AI_PERMISSION_STATUS_LABELS[status])}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              {venture.kind === "paid_tasks" ? (
                <div className="w-full sm:w-48">
                  <Select
                    value={oppAutoMode}
                    onValueChange={(value) => {
                      if (value) setOppAutoMode(value as AutomationMode);
                    }}
                  >
                    <SelectTrigger size="sm" aria-label={gt("Automation mode")}>
                      <SelectValue>{m(AUTOMATION_MODE_LABELS[oppAutoMode])}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end">
                      {AutomationMode.literals.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {m(AUTOMATION_MODE_LABELS[mode])}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}
              <Button
                size="sm"
                disabled={!canCreateOpp || submittingOpp || oppTitle.trim().length === 0}
                onClick={() => void handleAddOpportunity()}
              >
                <PlusIcon className="size-3.5" />
                <T>Add</T>
              </Button>
            </div>
          </div>

          {venture.kind !== "paid_tasks" ? (
            <OpportunitiesTable
              environmentId={environmentId}
              opportunities={detail.opportunities}
              canUpdate={canUpdateOpp}
              onStageChange={handleStageChange}
            />
          ) : null}
        </section>
      ) : null}

      {venture.kind === "web_agency" ||
      venture.kind === "voice_ai" ||
      venture.kind === "digital_products" ||
      venture.kind === "micro_saas" ||
      venture.kind === "custom" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section
            aria-label={gt("Prospects and Consent")}
            className="rounded-xl border border-border/80 bg-card/80"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <UsersIcon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  <T>Prospects &amp; Consent (UK PECR / GDPR)</T>
                </h2>
              </div>
              <Badge size="sm" variant="secondary">
                {detail.leads.length}
              </Badge>
            </div>

            <div className="space-y-2 border-b border-border/70 bg-muted/20 p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Input
                  size="sm"
                  value={leadName}
                  onChange={(event) => setLeadName(event.target.value)}
                  placeholder={gt("Contact name")}
                  aria-label={gt("Contact name")}
                />
                <Input
                  size="sm"
                  value={leadCompany}
                  onChange={(event) => setLeadCompany(event.target.value)}
                  placeholder={gt("Business name")}
                  aria-label={gt("Business name")}
                />
                <Input
                  size="sm"
                  value={leadEmail}
                  onChange={(event) => setLeadEmail(event.target.value)}
                  placeholder={gt("Email")}
                  aria-label={gt("Contact email")}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={leadConsentGranted}
                    onCheckedChange={(checked) => setLeadConsentGranted(Boolean(checked))}
                    aria-label={gt("Lawful consent recorded")}
                  />
                  <span>
                    <T>Lawful consent / B2B basis recorded</T>
                  </span>
                </label>
                <Button
                  size="xs"
                  disabled={!canCreateLead || submittingLead || leadName.trim().length === 0}
                  onClick={() => void handleAddLead()}
                >
                  <PlusIcon className="size-3.5" />
                  <T>Add prospect</T>
                </Button>
              </div>
            </div>

            {detail.leads.length === 0 ? (
              <p className="px-4 py-6 text-xs text-muted-foreground">
                <T>No prospects tracked yet.</T>
              </p>
            ) : (
              <div className="divide-y divide-border/70">
                {detail.leads.map((lead) => {
                  const consent = summarizeLeadConsent(lead);
                  return (
                    <div
                      key={lead.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">
                          {lead.name}
                          {lead.company ? ` · ${lead.company}` : ""}
                        </p>
                        {lead.email ? (
                          <p className="truncate text-2xs text-muted-foreground">{lead.email}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge size="sm" variant="outline">
                          {lead.stage}
                        </Badge>
                        <Badge
                          size="sm"
                          variant={
                            consent.status === "granted"
                              ? "success"
                              : consent.status === "opted_out"
                                ? "error"
                                : "warning"
                          }
                        >
                          {consent.status === "granted"
                            ? gt("Consent OK")
                            : consent.status === "opted_out"
                              ? gt("Opted Out")
                              : gt("Consent Needed")}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section
            aria-label={gt("Proposals and Disclosed Communications")}
            className="flex flex-col gap-6"
          >
            <div className="rounded-xl border border-border/80 bg-card/80">
              <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  <T>Proposals &amp; Quotations</T>
                </h2>
                <Badge size="sm" variant="secondary">
                  {detail.proposals.length}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/20 p-3">
                <div className="min-w-36 flex-1">
                  <Input
                    size="sm"
                    value={proposalTitle}
                    onChange={(event) => setProposalTitle(event.target.value)}
                    placeholder={gt("Proposal title (e.g. Website Rebuild)")}
                    aria-label={gt("Proposal title")}
                  />
                </div>
                <div className="w-28">
                  <Input
                    size="sm"
                    inputMode="decimal"
                    value={proposalAmountInput}
                    onChange={(event) => setProposalAmountInput(event.target.value)}
                    placeholder={gt("Quote ({currency})", {
                      currency: venture.budgetPolicy.currency,
                    })}
                    aria-label={gt("Quote amount")}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={
                    !canCreateProposal ||
                    submittingProposal ||
                    proposalTitle.trim().length === 0 ||
                    (parseMajorCurrencyToMinor(proposalAmountInput) ?? 0) <= 0
                  }
                  onClick={() => void handleCreateProposal()}
                >
                  <PlusIcon className="size-3.5" />
                  <T>Draft</T>
                </Button>
              </div>
              {detail.proposals.length === 0 ? (
                <p className="px-4 py-4 text-xs text-muted-foreground">
                  <T>No proposals drafted yet.</T>
                </p>
              ) : (
                <div className="divide-y divide-border/70">
                  {detail.proposals.map((proposal) => (
                    <div
                      key={proposal.id}
                      className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs"
                    >
                      <span className="truncate font-medium text-foreground">{proposal.title}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono tabular-nums">
                          {formatMinorCurrency(proposal.totalMinor, proposal.currency)}
                        </span>
                        <Badge size="sm" variant="outline">
                          {proposal.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border/80 bg-card/80">
              <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
                <div className="flex items-center gap-2">
                  <MailIcon className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">
                    <T>Communications Log</T>
                  </h2>
                </div>
                <Badge size="sm" variant="secondary">
                  {detail.communications.length}
                </Badge>
              </div>

              <div className="space-y-2 border-b border-border/70 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-32">
                    <Select
                      value={commChannel}
                      onValueChange={(value) => {
                        if (value) setCommChannel(value as ConsentChannel);
                      }}
                    >
                      <SelectTrigger size="sm" aria-label={gt("Channel")}>
                        <SelectValue>{m(CONSENT_CHANNEL_LABELS[commChannel])}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="start">
                        {ConsentChannel.literals.map((ch) => (
                          <SelectItem key={ch} value={ch}>
                            {m(CONSENT_CHANNEL_LABELS[ch])}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                  <div className="min-w-36 flex-1">
                    <Input
                      size="sm"
                      value={commSubject}
                      onChange={(event) => setCommSubject(event.target.value)}
                      placeholder={gt("Subject (optional)")}
                      aria-label={gt("Message subject")}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      size="sm"
                      value={commPreview}
                      onChange={(event) => setCommPreview(event.target.value)}
                      placeholder={gt("Outbound message preview...")}
                      aria-label={gt("Message preview")}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={!canCreateComm || submittingComm || commPreview.trim().length === 0}
                    onClick={() => void handleLogCommunication()}
                  >
                    <T>Queue</T>
                  </Button>
                </div>
                <label className="inline-flex items-center gap-2 text-2xs text-muted-foreground">
                  <Switch
                    checked={commAiDisclosed}
                    onCheckedChange={(checked) => setCommAiDisclosed(Boolean(checked))}
                    aria-label={gt("AI identity disclosed")}
                  />
                  <span>
                    <T>AI Agent identity transparently disclosed</T>
                  </span>
                </label>
              </div>

              {detail.communications.length === 0 ? (
                <p className="px-4 py-4 text-xs text-muted-foreground">
                  <T>No client or prospect communications recorded yet.</T>
                </p>
              ) : (
                <div className="divide-y divide-border/70">
                  {detail.communications.map((comm) => (
                    <div key={comm.id} className="space-y-1 px-4 py-2.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-medium text-foreground">
                          {comm.subject ?? m(CONSENT_CHANNEL_LABELS[comm.channel])}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge size="sm" variant={comm.aiDisclosed ? "success" : "warning"}>
                            {comm.senderType === "ai_agent"
                              ? comm.aiDisclosed
                                ? gt("AI Agent (Disclosed)")
                                : gt("AI Agent (Undisclosed)")
                              : gt("Human")}
                          </Badge>
                          <Badge size="sm" variant="outline">
                            {comm.status}
                          </Badge>
                        </div>
                      </div>
                      <p className="line-clamp-2 text-muted-foreground">{comm.bodyPreview}</p>
                      <p className="text-2xs text-muted-foreground tabular-nums">
                        {formatShortTimestamp(comm.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {detail.supportTickets.length > 0 || detail.orders.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-border/80 bg-card/80">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                <T>Orders</T>
              </h2>
              <Badge size="sm" variant="secondary">
                {detail.orders.length}
              </Badge>
            </div>
            <div className="divide-y divide-border/70">
              {detail.orders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs"
                >
                  <span className="truncate font-medium text-foreground">{order.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums">
                      {formatMinorCurrency(
                        order.amountMinor,
                        order.currency || DEFAULT_REPORTING_CURRENCY,
                      )}
                    </span>
                    <Badge size="sm" variant="outline">
                      {order.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border/80 bg-card/80">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                <T>Support Tickets</T>
              </h2>
              <Badge size="sm" variant="secondary">
                {detail.supportTickets.length}
              </Badge>
            </div>
            <div className="divide-y divide-border/70">
              {detail.supportTickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs"
                >
                  <span className="truncate font-medium text-foreground">{ticket.subject}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge size="sm" variant="outline">
                      {ticket.priority}
                    </Badge>
                    <Badge size="sm" variant="secondary">
                      {ticket.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
