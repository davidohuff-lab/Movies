"use client";

import { useEffect, useMemo, useRef } from "react";

import { PublicDataset } from "@/lib/domain";
import { normalizeSourceStatuses, summarizeSourceStatuses } from "@/lib/source-status";

interface SourceStatusDrawerProps {
  dataset: PublicDataset;
  open: boolean;
  onClose: () => void;
}

export function SourceStatusDrawer({ dataset, open, onClose }: SourceStatusDrawerProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const sourceStatuses = useMemo(() => normalizeSourceStatuses(dataset), [dataset]);

  useEffect(() => {
    if (!open || !dialogRef.current) {
      return;
    }

    const dialog = dialogRef.current;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    );
    const first = focusable[0];
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || focusable.length === 0) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? focusable.indexOf(active) : -1;
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="showtime-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="showtime-modal source-status-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-status-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-header">
          <div>
            <p className="eyebrow">Source status</p>
            <h2 id="source-status-title">Venue fetch health</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="source-status-list">
          {sourceStatuses.map((status) => (
            <article key={status.venueId} className="source-status-item">
              <div className="source-status-item-top">
                <strong>{status.venueName}</strong>
                <span className={`source-status-badge ${status.status.toLowerCase()}`}>{status.status}</span>
              </div>
              <p className="source-status-meta">
                Last successful update: {status.lastSuccessfulUpdate ? new Date(status.lastSuccessfulUpdate).toLocaleString("en-US", { timeZone: "America/New_York" }) : "None"}
              </p>
              {status.lastAttemptAt ? (
                <p className="source-status-meta">
                  Last attempt: {new Date(status.lastAttemptAt).toLocaleString("en-US", { timeZone: "America/New_York" })}
                </p>
              ) : null}
              {status.hint ? <p className="source-status-hint">{status.hint}</p> : null}
              {status.errorMessage ? <p className="source-status-error">{status.errorMessage}</p> : null}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SourceStatusSummary({ dataset, onOpen }: { dataset: PublicDataset; onOpen: () => void }) {
  const counts = summarizeSourceStatuses(normalizeSourceStatuses(dataset));

  return (
    <button type="button" className="source-summary-button" onClick={onOpen}>
      Sources: {counts.ok} OK · {counts.cached} cached · {counts.failed} failed
    </button>
  );
}
