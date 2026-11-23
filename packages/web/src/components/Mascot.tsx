import { useState } from "react";

interface MascotProps {
  /** Sticker file name under `/mascot/<name>.png`, also used for the fallback label. */
  name: string;
  size?: number;
  className?: string;
}

export function Mascot({ name, size = 160, className = "" }: MascotProps) {
  const [failed, setFailed] = useState(false);
  const label = `${name.toUpperCase()}!`;

  if (failed) {
    return (
      <div
        role="img"
        aria-label={label}
        style={{ width: size, height: size }}
        className={`flex rotate-[-4deg] items-center justify-center rounded-2xl border-2 border-dashed border-indigo-400/50 bg-indigo-500/10 font-mono text-2xl font-bold tracking-wider text-indigo-300 ${className}`}
      >
        {label}
      </div>
    );
  }

  return (
    <img
      src={`/mascot/${encodeURIComponent(name)}.png`}
      alt={label}
      width={size}
      height={size}
      draggable={false}
      onError={() => setFailed(true)}
      className={`rotate-[-4deg] select-none object-contain drop-shadow-lg ${className}`}
    />
  );
}
