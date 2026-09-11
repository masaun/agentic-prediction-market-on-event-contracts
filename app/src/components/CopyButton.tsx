"use client";

import { useState } from "react";

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — nothing more we can do
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? "Copied!" : "Copy to clipboard"}
      className={`text-muted hover:text-accent transition-colors ${className ?? ""}`}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}
