"use client";

interface ShowtimePickerModalProps {
  open: boolean;
  filmTitle: string;
  venueName: string;
  options: Array<{ screeningId: string; label: string }>;
  onClose: () => void;
  onSelect: (screeningId: string) => void;
}

export function ShowtimePickerModal({
  open,
  filmTitle,
  venueName,
  options,
  onClose,
  onSelect
}: ShowtimePickerModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="showtime-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="showtime-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="showtime-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">Add to calendar</p>
        <h2 id="showtime-picker-title">{filmTitle}</h2>
        <p className="showtime-modal-copy">
          Multiple showtimes are available at {venueName}. Choose the screening you want to save.
        </p>
        <div className="showtime-modal-options">
          {options.map((option) => (
            <button
              key={option.screeningId}
              type="button"
              className="showtime-modal-option"
              onClick={() => onSelect(option.screeningId)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
