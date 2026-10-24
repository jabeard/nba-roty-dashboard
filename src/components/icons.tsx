import type { CSSProperties } from "react";

export function Basketball({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 16h26M16 3v26M7 6c11 7 7 13 18 20M25 6C14 13 18 19 7 26" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true"><path d="M4 14 14 4M4 4h10v10" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

export function PlayerAvatar({
  name, color, large = false,
}: { name: string; color: string; large?: boolean }) {
  const initials = name.split(" ").slice(0, 2).map((part) => part[0]).join("");
  return <span className={`avatar ${large ? "avatar-large" : ""}`} style={{ "--team-color": color } as CSSProperties} aria-hidden="true">{initials}</span>;
}
