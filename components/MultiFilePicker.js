"use client";

import { DeleteIcon, DocumentIcon, IconButton } from "@/components/Icons";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// File input that accumulates a list: picking files again adds to the list
// (so files from different folders can be combined), and each one can be
// removed before uploading.
export default function MultiFilePicker({ files, onChange, disabled }) {
  function addFiles(e) {
    const picked = Array.from(e.target.files || []);
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (!picked.length) return;
    const key = (f) => `${f.name}|${f.size}|${f.lastModified}`;
    const existing = new Set(files.map(key));
    onChange([...files, ...picked.filter((f) => !existing.has(key(f)))]);
  }

  function removeAt(index) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <input
        type="file"
        multiple
        className="text-sm"
        onChange={addFiles}
        disabled={disabled}
      />
      <p className="text-xs text-ink-500">
        ניתן לבחור כמה קבצים יחד, או להוסיף קבצים נוספים בבחירה חוזרת.
      </p>
      {files.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line bg-white">
          {files.map((f, i) => (
            <li
              key={`${f.name}|${f.size}|${f.lastModified}`}
              className="flex items-center gap-2 px-3 py-2 text-sm"
            >
              <DocumentIcon className="w-4 h-4 shrink-0 text-ink-500" />
              <span className="flex-1 truncate" title={f.name}>
                {f.name}
              </span>
              <span className="text-xs text-ink-500 whitespace-nowrap">
                {formatSize(f.size)}
              </span>
              <IconButton
                variant="delete"
                title="הסרה מהרשימה"
                onClick={() => removeAt(i)}
                disabled={disabled}
              >
                <DeleteIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
