import { useEffect, useId, useRef, useState } from "react";
import { usePinky } from "./PinkyProvider";
import FeatherIcon from "./FeatherIcon";

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="note-menu-icon" aria-hidden="true">
      <path d="M6 4.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V6A1.5 1.5 0 0 1 6.5 4.5Z" />
      <path d="M14 4.5V9h4" />
      <path d="M8 12.5h8M8 16h6" />
    </svg>
  );
}

export default function RunNoteMenu({ noteExists, onEditNote }) {
  const menuId = useId();
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const { enabled, toggleEnabled, coarsePointer, reducedMotion } = usePinky();

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggleHint = coarsePointer
    ? "Pinky is desktop-only for now."
    : reducedMotion
      ? "Reduced motion keeps Pinky in a calmer chase mode."
      : enabled
        ? "Pinky is currently roaming the workspace."
        : "Wake Pinky up for playful mouse chasing.";

  return (
    <div ref={menuRef} className={`note-menu ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className={`btn btn-small btn-ghost note-menu-trigger ${open ? "is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        title="Open note menu"
      >
        <NoteIcon />
        <span>Notes</span>
      </button>

      {open && (
        <div id={menuId} className="note-menu-panel" role="menu" aria-label="Note menu">
          <button
            type="button"
            className="note-menu-item"
            role="menuitem"
            onClick={() => {
              onEditNote();
              setOpen(false);
            }}
          >
            <NoteIcon />
            <div>
              <strong>{noteExists ? "Edit note" : "Add note"}</strong>
              <p>{noteExists ? "Update the run summary and observations." : "Capture what made this run worth keeping."}</p>
            </div>
          </button>

          <button
            type="button"
            className={`note-menu-item feather-toggle ${enabled ? "is-enabled" : ""}`}
            role="menuitemcheckbox"
            aria-checked={enabled}
            onClick={() => {
              if (!coarsePointer) {
                toggleEnabled();
              }
              setOpen(false);
            }}
            title={toggleHint}
          >
            <FeatherIcon active={enabled && !coarsePointer} />
            <div>
              <strong>{enabled ? "Pinky on" : "Pinky off"}</strong>
              <p>{toggleHint}</p>
            </div>
            <span className={`note-menu-state ${enabled ? "is-on" : "is-off"}`}>
              {coarsePointer ? "Unavailable" : enabled ? "On" : "Off"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
