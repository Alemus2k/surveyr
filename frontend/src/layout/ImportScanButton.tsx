import { useRef, type ReactNode } from "react";

const ACCEPT = ".ply,.las,.laz,.xyz";

interface ImportScanButtonProps {
  onFile: (file: File) => void;
  busy: boolean;
  className: string;
  label: string; // accessible name
  children: ReactNode;
}

/** Button that opens the system file picker for a point-cloud file. */
export function ImportScanButton({ onFile, busy, className, label, children }: ImportScanButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className={className}
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={label}
        title={label}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow re-importing the same file
          if (file) onFile(file);
        }}
      />
    </>
  );
}
