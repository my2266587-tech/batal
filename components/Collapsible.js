"use client";

import { ChevronDownIcon } from "@/components/Icons";

// A card section that opens/closes with one tap — keeps rarely used parts
// of a page out of the way. Built on <details>, so it needs no state.
export default function Collapsible({ title, count, defaultOpen = false, children, className = "" }) {
  return (
    <details className={"card collapsible " + className} open={defaultOpen || undefined}>
      <summary className="flex items-center justify-between gap-3 px-5 py-4 min-h-[56px] cursor-pointer select-none rounded-2xl hover:bg-surface-subtle">
        <span className="text-lg font-semibold text-ink-900">
          {title}
          {count != null && <span className="text-ink-500 font-normal"> ({count})</span>}
        </span>
        <ChevronDownIcon className="collapsible-chevron w-5 h-5 text-ink-500 transition-transform flex-shrink-0" />
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}
