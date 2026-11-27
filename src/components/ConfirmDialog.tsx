import { useEffect, useId, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel = "Onayla",
  cancelLabel = "Vazgeç",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;

    cancelBtnRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, title]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      data-testid="confirm-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={`dialog-panel dialog-panel--${tone}`}
      >
        <div className="dialog-header">
          <div className={`dialog-icon dialog-icon--${tone}`}>
            <AlertTriangle size={18} aria-hidden="true" />
          </div>
          <div className="dialog-title-wrap">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            <p id={descId} className="dialog-description">
              {description}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Kapat"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </div>

        {details && details.length > 0 && (
          <ul className="dialog-details">
            {details.map((item, idx) => (
              <li key={`${idx}-${item}`} className="mono">
                {item}
              </li>
            ))}
          </ul>
        )}

        <div className="dialog-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn btn--${tone}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "İşleniyor..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
