"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Mail } from "lucide-react";
import type { BrevoSender } from "@/lib/email/manual";

type EmailSenderPickerProps = {
  senders: BrevoSender[];
  value: string;
  disabled?: boolean;
  loading?: boolean;
  onChange: (senderId: string) => void;
};

export function EmailSenderPicker({
  senders,
  value,
  disabled = false,
  loading = false,
  onChange,
}: EmailSenderPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = senders.findIndex(
    (sender) => String(sender.id) === value,
  );
  const selected = selectedIndex >= 0 ? senders[selectedIndex] : null;
  const activeId =
    open && senders[activeIndex]
      ? `email-sender-option-${senders[activeIndex].id}`
      : undefined;

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function openList(index = selectedIndex >= 0 ? selectedIndex : 0) {
    if (disabled || senders.length === 0) return;
    setActiveIndex(index);
    setOpen(true);
  }

  function select(index: number) {
    const sender = senders[index];
    if (!sender) return;
    onChange(String(sender.id));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openList();
      else setActiveIndex((index) => Math.min(index + 1, senders.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openList();
      else setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(senders.length - 1);
    } else if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      select(activeIndex);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="email-sender-field" ref={rootRef}>
      <span className="email-sender-field__label" id="email-sender-label">
        From
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="email-sender-picker"
        role="combobox"
        aria-labelledby="email-sender-label"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="email-sender-listbox"
        aria-activedescendant={activeId}
        disabled={disabled || senders.length === 0}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="email-sender-picker__identity">
          <span className="email-sender-picker__avatar" aria-hidden="true">
            <Mail size={18} />
          </span>
          {selected ? (
            <span className="email-sender-picker__text">
              <span className="email-sender-picker__name">{selected.name}</span>
              <span className="email-sender-picker__address">
                {selected.email}
              </span>
            </span>
          ) : (
            <span className="email-sender-picker__placeholder">
              {loading ? "Loading verified senders…" : "Select a sender"}
            </span>
          )}
        </span>
        <ChevronDown
          className={`email-sender-picker__chevron${open ? " is-open" : ""}`}
          size={19}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          className="email-sender-picker__list"
          id="email-sender-listbox"
          role="listbox"
          aria-labelledby="email-sender-label"
        >
          {senders.map((sender, index) => {
            const isSelected = String(sender.id) === value;
            const isActive = index === activeIndex;
            return (
              <button
                key={sender.id}
                id={`email-sender-option-${sender.id}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={[
                  "email-sender-picker__option",
                  isActive ? "is-active" : "",
                  isSelected ? "is-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(index)}
              >
                <span className="email-sender-picker__option-avatar" aria-hidden="true">
                  <Mail size={17} />
                </span>
                <span className="email-sender-picker__text">
                  <span className="email-sender-picker__name">{sender.name}</span>
                  <span className="email-sender-picker__address">
                    {sender.email}
                  </span>
                </span>
                {isSelected && (
                  <Check
                    className="email-sender-picker__check"
                    size={18}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
