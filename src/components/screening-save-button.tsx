"use client";

import { useEffect, useState } from "react";

import { readSavedScreeningIds, writeSavedScreeningIds } from "@/lib/calendar-storage";

interface ScreeningSaveButtonProps {
  screeningId: string;
}

export function ScreeningSaveButton({ screeningId }: ScreeningSaveButtonProps) {
  const [savedScreeningIds, setSavedScreeningIds] = useState<string[]>([]);

  useEffect(() => {
    setSavedScreeningIds(readSavedScreeningIds(window.localStorage));
  }, []);

  const isSaved = savedScreeningIds.includes(screeningId);

  function onToggle() {
    const next = isSaved
      ? savedScreeningIds.filter((candidate) => candidate !== screeningId)
      : [...savedScreeningIds, screeningId];
    setSavedScreeningIds(writeSavedScreeningIds(window.localStorage, next));
  }

  return (
    <button
      type="button"
      className={isSaved ? "chip active" : "chip"}
      aria-label={isSaved ? "Saved to Calendar" : "Save to Calendar"}
      onClick={onToggle}
    >
      {isSaved ? "Saved" : "Add to calendar"}
    </button>
  );
}
