"use client";

import { useEffect, useState } from "react";
import { sanitizeQuestPayload } from "@/lib/payload";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: string) => Promise<void>;
};

export default function QuestCodeModal({ open, onClose, onSubmit }: Props) {
  const [payload, setPayload] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPayload("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const submit = async () => {
    if (payload.length !== 6) {
      setError("Enter exactly 6 digits.");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      await onSubmit(payload);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit payload.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quest-code-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="quest-code-title">Enter Quest Payload</h3>
        <p className="muted">Use the 6-digit mission payload.</p>

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={payload}
          onChange={(event) => setPayload(sanitizeQuestPayload(event.target.value))}
          placeholder="000000"
          className="code-input"
        />

        <div className="inline-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy || payload.length !== 6}>
            {busy ? "Submitting..." : "Submit"}
          </button>
        </div>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
