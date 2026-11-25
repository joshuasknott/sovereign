import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_REPORTING_CURRENCY,
  type EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import {
  ComposerSpeechButton,
  ComposerSpeechRecordingPill,
} from "../components/chat/ComposerSpeechButton";
import { VoiceInputSetup } from "../components/chat/VoiceInputSetup";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { getAppModelOptionsForInstance } from "../modelSelection";
import { NO_PROVIDER_MODEL_SELECTION, providerInstanceEntriesFor } from "../providerInstances";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { useEnvironmentSpeechInput } from "../speech/useEnvironmentSpeechInput";
import { useEnvironmentProviders } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { sovereignCommands, useSovereignCommandPermission } from "../state/sovereign";
import { useAtomCommand } from "../state/use-atom-command";

export function SovereignCommandComposer({
  environmentId,
  reportingCurrency = DEFAULT_REPORTING_CURRENCY,
}: {
  readonly environmentId: EnvironmentId;
  readonly reportingCurrency?: string | undefined;
}) {
  const gt = useGT();
  const [instruction, setInstruction] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canCreate = useSovereignCommandPermission(
    environmentId,
    sovereignCommands.createObjectiveCommand,
  );
  const canChat = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const createObjective = useAtomCommand(sovereignCommands.createObjectiveCommand, {
    label: "sovereign-create-objective",
  });
  const openDraft = useNewThreadHandler();
  const { openScratchProject } = useScratchProject();
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? [];
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const options = new Map(
    entries.map((entry) => [entry.instanceId, getAppModelOptionsForInstance(settings, entry)]),
  );
  const picked = selection ?? NO_PROVIDER_MODEL_SELECTION;
  const threadMode = selection !== null || files.length > 0;
  const speech = useEnvironmentSpeechInput({
    environmentId,
    ownerKey: `sovereign-overview:${environmentId}`,
    disabled: submitting || !(canCreate || canChat),
    readDraft: () => ({
      text: instruction,
      selection: {
        start: textarea.current?.selectionStart ?? instruction.length,
        end: textarea.current?.selectionEnd ?? instruction.length,
      },
    }),
    commitDraft: (text, position) => {
      setInstruction(text);
      requestAnimationFrame(() =>
        textarea.current?.setSelectionRange(position.start, position.end),
      );
    },
  });
  const enabled =
    !submitting &&
    !speech.blocksSubmission &&
    (threadMode ? canChat : canCreate) &&
    (instruction.trim().length > 0 || files.length > 0);
  const submit = async () => {
    if (!enabled) return;
    setSubmitting(true);
    try {
      const trimmed = instruction.trim();
      if (threadMode) {
        const project = await openScratchProject(environmentId);
        if (!project) return;
        const draft = await openDraft(scopeProjectRef(environmentId, project.id), {
          prompt: trimmed,
        });
        if (!draft) return;
        if (selection)
          useComposerDraftStore
            .getState()
            .setModelSelection(draft.draftId, selection, { explicit: true, replaceOptions: true });
        if (files.length)
          useSidebarPendingFileDropStore.getState().queuePendingFileDrop({
            threadRef: scopeThreadRef(environmentId, draft.threadId),
            files,
          });
      } else {
        const result = await createObjective({
          environmentId,
          input: {
            title: trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed,
            description: trimmed,
            horizon: "ongoing",
            currency: reportingCurrency,
            maxSpendMinor: 0,
          },
        });
        if (result._tag !== "Success") return;
        toastManager.add({
          type: "success",
          title: gt("Commercial objective queued"),
          description: result.value.title,
        });
      }
      setInstruction("");
      setFiles([]);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: gt("Could not open thread"),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };
  const sendLabel = threadMode ? gt("Continue in thread") : gt("Direct Sovereign");
  return (
    <form
      className="sv-composer"
      aria-label={gt("Direct Sovereign")}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={textarea}
        rows={1}
        value={instruction}
        readOnly={submitting}
        aria-label={gt("Commercial instruction for Sovereign")}
        placeholder={gt("What would you like Sovereign to do?")}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {files.length > 0 && (
        <div className="sv-attachments">
          {files.map((file, index) => (
            <button
              type="button"
              key={index}
              disabled={submitting}
              onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
              aria-label={gt("Remove {name}", { name: file.name })}
            >
              {file.name} ×
            </button>
          ))}
        </div>
      )}
      {speech.preview && (
        <p aria-live="polite">
          {speech.preview.committed}
          {speech.preview.tentative}
        </p>
      )}
      <div className="sv-composer-tools">
        <input
          hidden
          type="file"
          multiple
          ref={fileInput}
          onChange={(event) => {
            const added = Array.from(event.currentTarget.files ?? []);
            setFiles((current) => [...current, ...added]);
            event.currentTarget.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!canChat || submitting}
          aria-label={gt("Attach files")}
          title={gt("Attach files")}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip />
        </Button>
        <ProviderModelPicker
          environmentId={environmentId}
          activeInstanceId={picked.instanceId}
          model={picked.model}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={options}
          disabled={!canChat || submitting}
          triggerLabel={selection?.model ?? gt("Model")}
          triggerAriaLabel={gt("Select model")}
          onInstanceModelChange={(instanceId, model) => setSelection({ instanceId, model })}
        />
        {selection && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Clear model selection")}
            onClick={() => setSelection(null)}
          >
            <X />
          </Button>
        )}
        <div className="sv-mic">
          <ComposerSpeechRecordingPill
            state={speech.state}
            progress={null}
            level={speech.level}
            recordingStartedAt={speech.recordingStartedAt}
            onStart={() => void speech.start()}
            onStop={() => void speech.stop()}
            onCancel={speech.cancel}
            onSkipPostProcessing={speech.skipPostProcessing}
          />
          <ComposerSpeechButton
            state={speech.state}
            disabled={!speech.available || submitting || !(canChat || canCreate)}
            onStart={() => void speech.start()}
          />
        </div>
        <button
          className="sv-send"
          type="submit"
          disabled={!enabled}
          aria-label={sendLabel}
          title={sendLabel}
        >
          <ArrowUp aria-hidden="true" />
        </button>
      </div>
      <VoiceInputSetup
        environmentId={speech.transcriptionEnvironmentId}
        open={speech.setup.open}
        step={speech.setup.step}
        status={speech.status}
        model={speech.setup.model}
        language={speech.setup.language}
        downloading={speech.setup.downloading}
        error={speech.setup.error}
        onOpenChange={speech.setup.setOpen}
        onRetryCatalog={speech.setup.retryCatalog}
        onDownload={() => void speech.setup.download()}
        onCancelDownload={() => void speech.setup.cancelDownload()}
        onStartRecording={() => void speech.setup.startRecording()}
      />
    </form>
  );
}
