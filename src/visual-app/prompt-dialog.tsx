import { useState, type FormEvent } from "react";

export interface PromptDialogProps {
  readonly title: string;
  readonly label: string;
  readonly initialValue: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: (value: string) => void;
  readonly onCancel: () => void;
}

/**
 * One line of text, asked for. The sibling of `ConfirmDialog`: that one asks a
 * yes-or-no before something destructive, this one asks for a value before
 * something the reviewer has to name.
 *
 * A blank answer is refused by disabling the button rather than by staging a
 * row that the projection schema would then reject — `presentation.title` is
 * required non-empty text, so an empty rename can only ever come back as a
 * fault.
 *
 * The value lives here rather than in the caller because it belongs to the
 * dialog while it is on screen: a half-typed name is not workspace state, and
 * closing the dialog is what discards it.
 */
export function PromptDialog({
  title,
  label,
  initialValue,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const blank = value.trim() === "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blank) return;
    onConfirm(value.trim());
  };

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="prompt-dialog-title">{title}</h2>
        <form className="prompt-dialog-form" onSubmit={submit}>
          <label htmlFor="prompt-dialog-value">{label}</label>
          <input
            id="prompt-dialog-value"
            type="text"
            value={value}
            autoFocus
            onChange={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
            }}
          />
          <div className="confirm-dialog-actions">
            <button type="button" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="submit" disabled={blank}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
