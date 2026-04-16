export default function FeatherIcon({ active = false, className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`note-menu-icon feather-icon ${active ? "is-active" : ""} ${className}`.trim()}
      aria-hidden="true"
    >
      <path d="M18.2 4.7c-2.5-.8-5.5.2-7.2 2.4-1.4 1.8-2 4.3-1.4 6.5L4.8 18.4c-.8.8-.8 2 0 2.8s2 .8 2.8 0l4.8-4.8c2.3.6 4.8 0 6.5-1.4 2.2-1.7 3.2-4.7 2.4-7.2-.2-.6-.7-1.1-1.3-1.3Z" />
      <path d="M8.5 15.5 16 8M10 18l2.1-2.1M12 12l2.5 2.5" />
    </svg>
  );
}
