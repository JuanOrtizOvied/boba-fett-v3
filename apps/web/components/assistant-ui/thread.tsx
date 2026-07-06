"use client";

import { useRef, type FC } from "react";
import type { Attachment, AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  CompositeAttachmentAdapter,
  ErrorPrimitive,
  MessagePrimitive,
  SimpleImageAttachmentAdapter,
  ThreadPrimitive,
} from "@assistant-ui/react";
import {
  CameraIcon,
  ClipIcon,
  FileIcon,
  LinkIcon,
  PdfIcon,
  RobotIcon,
  SendIcon,
} from "@/components/icons/Icons";

/**
 * Converts a `File` to a base64 data URL, matching the pattern used by
 * `SimpleImageAttachmentAdapter` in `@assistant-ui/core`.
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * Attachment adapter for PDFs and other binary documents (statements,
 * factsheets). Converts the file to a base64 `file` content part so it
 * reaches the LangGraph agent the same way `getMessageContent` expects
 * (`{ type: "file", data, mime_type, metadata: { filename } }`).
 */
class Base64DocumentAttachmentAdapter implements AttachmentAdapter {
  public accept = "application/pdf,.pdf";

  async add(state: { file: File }): Promise<PendingAttachment> {
    return {
      id: `${state.file.name}-${state.file.size}-${Date.now()}`,
      type: "document",
      name: state.file.name,
      contentType: state.file.type || "application/pdf",
      file: state.file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const dataUrl = await readFileAsDataUrl(attachment.file);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          data: base64,
          mimeType: attachment.contentType ?? "application/pdf",
        },
      ],
    };
  }

  async remove() {
    // No remote resource to clean up — the file only ever lives client-side
    // until it is inlined as base64 in the outgoing message.
  }
}

/**
 * Shared attachment adapter — images go through the base64 `SimpleImage`
 * adapter, PDFs/documents through `Base64DocumentAttachmentAdapter`. Exported
 * so `assistant.tsx` can wire it into `useLangGraphRuntime`'s `adapters`.
 */
export const attachmentAdapter = new CompositeAttachmentAdapter([
  new SimpleImageAttachmentAdapter(),
  new Base64DocumentAttachmentAdapter(),
]);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentIcon({ attachment }: { attachment: Attachment }) {
  if (attachment.type === "image") return <CameraIcon size={16} />;
  if (attachment.contentType === "application/pdf") return <PdfIcon size={16} />;
  return <FileIcon size={16} />;
}

/**
 * Chat thread UI wired to the LangGraph runtime, styled for SABBI:
 * - User messages: indigo accent background, file attachments as chips
 *   inside the same bubble (never separate messages).
 * - Assistant messages: neutral background, recoverable error UI.
 * - Welcome message listing supported input types when the thread is empty.
 * - Pinned composer with drag-and-drop / click-to-upload and quick-action
 *   shortcuts (Captura, PDF, Link, Factsheet).
 */
export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col bg-background">
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
        <ThreadPrimitive.If empty>
          <WelcomeMessage />
        </ThreadPrimitive.If>

        <ThreadPrimitive.Messages>
          {({ message }) => {
            if (message.role === "user") return <UserMessage />;
            if (message.role === "assistant") return <AssistantMessage />;
            return null;
          }}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>

      <div className="shrink-0 border-t border-sabbi-neutral-200 px-4 py-4">
        <Composer />
      </div>
    </ThreadPrimitive.Root>
  );
};

const SUPPORTED_INPUTS = [
  { icon: CameraIcon, label: "Capturas de pantalla" },
  { icon: PdfIcon, label: "PDFs de estados de cuenta" },
  { icon: FileIcon, label: "Factsheets de fondos" },
  { icon: LinkIcon, label: "Links de productos" },
] as const;

const WelcomeMessage: FC = () => {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-sabbi-primary-soft text-sabbi-primary">
        <RobotIcon size={24} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-sabbi-neutral-900">
          ¡Hola! Soy el asistente de SABBI
        </p>
        <p className="text-sm text-sabbi-neutral-600">
          Contame sobre tus inversiones y arme tu portafolio. Podés
          compartirme:
        </p>
      </div>
      <ul className="flex w-full flex-col gap-2">
        {SUPPORTED_INPUTS.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-center gap-2 rounded-lg bg-sabbi-neutral-50 px-3 py-2 text-left text-sm text-sabbi-neutral-700"
          >
            <Icon size={18} className="shrink-0 text-sabbi-primary" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
      <div className="flex flex-col gap-2 rounded-2xl bg-sabbi-primary px-4 py-2 text-white">
        <MessagePrimitive.Content />
        <MessagePrimitive.Attachments>
          {({ attachment }) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs"
            >
              <AttachmentIcon attachment={attachment} />
              <span className="max-w-[160px] truncate">{attachment.name}</span>
              {attachment.file ? (
                <span className="text-white/70">
                  {formatFileSize(attachment.file.size)}
                </span>
              ) : null}
            </div>
          )}
        </MessagePrimitive.Attachments>
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="mr-auto flex max-w-[85%] flex-col items-start gap-1">
      <div className="rounded-2xl bg-sabbi-neutral-100 px-4 py-2 text-sabbi-neutral-900">
        <MessagePrimitive.Content />
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="mt-2 flex flex-col gap-2 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
            <ErrorPrimitive.Message />
            <ActionBarPrimitive.Root>
              <ActionBarPrimitive.Reload className="w-fit text-xs font-medium underline">
                Retry
              </ActionBarPrimitive.Reload>
            </ActionBarPrimitive.Root>
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  );
};

const QUICK_ACTIONS = [
  { icon: CameraIcon, label: "Captura" },
  { icon: PdfIcon, label: "PDF" },
  { icon: FileIcon, label: "Factsheet" },
] as const;

const Composer: FC = () => {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <ComposerPrimitive.Root className="flex flex-col gap-2">
      {/* `data-dragging="true"` is set by the primitive itself while a file
          is dragged over the dropzone — no need to track drag state manually. */}
      <ComposerPrimitive.AttachmentDropzone className="flex flex-col gap-2 rounded-xl border border-sabbi-neutral-200 px-3 py-2 transition-colors data-[dragging=true]:border-sabbi-primary data-[dragging=true]:bg-sabbi-primary-soft">
        <ComposerPrimitive.Attachments>
          {({ attachment }) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-lg bg-sabbi-neutral-100 px-2.5 py-1.5 text-xs text-sabbi-neutral-700"
            >
              <AttachmentIcon attachment={attachment} />
              <span className="max-w-[160px] truncate">{attachment.name}</span>
            </div>
          )}
        </ComposerPrimitive.Attachments>

        <div className="flex items-end gap-2">
          <ComposerPrimitive.AddAttachment
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sabbi-neutral-600 transition-colors hover:bg-sabbi-neutral-100"
            aria-label="Adjuntar archivo"
          >
            <ClipIcon size={18} />
          </ComposerPrimitive.AddAttachment>

          <ComposerPrimitive.Input
            ref={inputRef}
            placeholder="Contame sobre tus inversiones..."
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent text-sm outline-none"
          />

          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sabbi-primary text-white disabled:opacity-40">
              <SendIcon size={16} />
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel className="rounded-lg border border-sabbi-neutral-300 px-3 py-1.5 text-sm">
              Cancel
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
        </div>
      </ComposerPrimitive.AttachmentDropzone>

      <div className="flex items-center gap-1.5">
        {QUICK_ACTIONS.map(({ icon: Icon, label }) => (
          <ComposerPrimitive.AddAttachment
            key={label}
            className="flex items-center gap-1.5 rounded-full border border-sabbi-neutral-200 px-2.5 py-1 text-xs font-medium text-sabbi-neutral-600 transition-colors hover:bg-sabbi-neutral-50"
          >
            <Icon size={14} />
            {label}
          </ComposerPrimitive.AddAttachment>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          className="flex items-center gap-1.5 rounded-full border border-sabbi-neutral-200 px-2.5 py-1 text-xs font-medium text-sabbi-neutral-600 transition-colors hover:bg-sabbi-neutral-50"
        >
          <LinkIcon size={14} />
          Link
        </button>
      </div>
    </ComposerPrimitive.Root>
  );
};
