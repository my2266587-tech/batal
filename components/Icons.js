"use client";

export function EditIcon({ className = "w-4 h-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M14.69 2.66a2.25 2.25 0 0 1 3.18 3.18l-9.9 9.9a3 3 0 0 1-1.4.79l-2.83.7a.75.75 0 0 1-.9-.91l.7-2.83a3 3 0 0 1 .79-1.4l9.9-9.9zm2.12 1.06a.75.75 0 0 0-1.06 0L5.85 13.62a1.5 1.5 0 0 0-.4.7l-.42 1.7 1.7-.42a1.5 1.5 0 0 0 .7-.4l9.9-9.9a.75.75 0 0 0 0-1.06z" />
    </svg>
  );
}

export function DeleteIcon({ className = "w-4 h-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 0 0 6 3.75V4H3.5a.75.75 0 0 0 0 1.5h.34l.51 9.16A3 3 0 0 0 7.34 17.5h5.32a3 3 0 0 0 2.99-2.84l.51-9.16h.34a.75.75 0 0 0 0-1.5H14v-.25A2.75 2.75 0 0 0 11.25 1h-2.5zm3.75 3v-.25c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25V4h5zM8.5 7.75a.75.75 0 0 1 1.5 0v6a.75.75 0 0 1-1.5 0v-6zm3.5 0a.75.75 0 0 0-1.5 0v6a.75.75 0 0 0 1.5 0v-6z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function ChevronDownIcon({ className = "w-4 h-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function DocumentIcon({ className = "w-4 h-4" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4 4a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4zm8 1.5V8a1 1 0 0 0 1 1h2.5L12 5.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const VARIANTS = {
  default: "text-ink-500 hover:bg-surface-subtle hover:text-ink-900",
  edit: "text-ink-500 hover:bg-accent-50 hover:text-accent-700",
  delete: "text-ink-500 hover:bg-red-50 hover:text-red-700",
};

export function IconButton({
  children,
  onClick,
  variant = "default",
  title,
  ...rest
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        "inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors " +
        VARIANTS[variant]
      }
      {...rest}
    >
      {children}
    </button>
  );
}
