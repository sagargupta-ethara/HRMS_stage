"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

export function StarRating({
  value,
  onChange,
  size = "md",
}: {
  value: number;
  onChange?: (value: number) => void;
  size?: "sm" | "md";
}) {
  const dimension = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(star === value ? 0 : star)}
          className={cn(!onChange && "cursor-default", onChange && "transition-transform hover:scale-110")}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
        >
          <Star
            className={cn(
              dimension,
              star <= value ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/40"
            )}
          />
        </button>
      ))}
    </div>
  );
}
