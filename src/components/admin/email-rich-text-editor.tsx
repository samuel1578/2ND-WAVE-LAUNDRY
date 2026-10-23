"use client";

import { useRef } from "react";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Underline,
  Unlink,
  Redo2,
  Undo2,
} from "lucide-react";

type EmailRichTextEditorProps = {
  resetKey: number;
  disabled?: boolean;
  onChange: (html: string) => void;
};

type EditorCommand = {
  command: string;
  value?: string;
};

const TOOLBAR_COMMANDS: Array<{
  label: string;
  icon: typeof Bold;
  command: EditorCommand;
}> = [
  { label: "Bold", icon: Bold, command: { command: "bold" } },
  { label: "Italic", icon: Italic, command: { command: "italic" } },
  { label: "Underline", icon: Underline, command: { command: "underline" } },
  {
    label: "Heading 2",
    icon: Heading2,
    command: { command: "formatBlock", value: "h2" },
  },
  {
    label: "Heading 3",
    icon: Heading3,
    command: { command: "formatBlock", value: "h3" },
  },
  {
    label: "Bulleted list",
    icon: List,
    command: { command: "insertUnorderedList" },
  },
  {
    label: "Numbered list",
    icon: ListOrdered,
    command: { command: "insertOrderedList" },
  },
  {
    label: "Block quote",
    icon: Quote,
    command: { command: "formatBlock", value: "blockquote" },
  },
  { label: "Undo", icon: Undo2, command: { command: "undo" } },
  { label: "Redo", icon: Redo2, command: { command: "redo" } },
  {
    label: "Clear formatting",
    icon: RemoveFormatting,
    command: { command: "removeFormat" },
  },
];

export function EmailRichTextEditor({
  resetKey,
  disabled = false,
  onChange,
}: EmailRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  function runCommand({ command, value }: EditorCommand) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }

  function addLink() {
    const input = window.prompt("Enter the link URL (https:// or mailto:)");
    const url = input?.trim();
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) {
      window.alert("Use a full https:// link or a mailto: address.");
      return;
    }
    runCommand({ command: "createLink", value: url });
  }

  return (
    <div className="email-rich-editor">
      <div
        className="email-rich-editor__toolbar"
        role="toolbar"
        aria-label="Message formatting"
      >
        {TOOLBAR_COMMANDS.map(({ label, icon: Icon, command }) => (
          <button
            key={label}
            type="button"
            className="email-rich-editor__tool"
            aria-label={label}
            title={label}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand(command)}
          >
            <Icon size={17} aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          className="email-rich-editor__tool"
          aria-label="Insert link"
          title="Insert link"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={addLink}
        >
          <Link2 size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="email-rich-editor__tool"
          aria-label="Remove link"
          title="Remove link"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => runCommand({ command: "unlink" })}
        >
          <Unlink size={17} aria-hidden="true" />
        </button>
      </div>
      <div
        key={resetKey}
        ref={editorRef}
        className="email-rich-editor__content"
        id="email-compose-message-editor"
        contentEditable={!disabled}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        suppressContentEditableWarning
        role="textbox"
        aria-label="Message"
        aria-multiline="true"
        data-placeholder="Write your message…"
        onInput={(event) => {
          if (!disabled) onChange(event.currentTarget.innerHTML);
        }}
      />
    </div>
  );
}
