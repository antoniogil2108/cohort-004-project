import { Star } from "lucide-react";
import { cn } from "~/lib/utils";

const SIZE_CLASS = {
  sm: "size-3.5",
  md: "size-5",
} as const;

/**
 * Read-only star display with precise fractional fill. Renders an empty row of
 * five stars with an amber-filled row clipped on top to `(value / 5) * 100%`.
 */
export function StarRating({
  value,
  size = "sm",
  className,
}: {
  value: number;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  const sizeClass = SIZE_CLASS[size];
  const fillPercent = Math.max(0, Math.min(1, value / 5)) * 100;

  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      aria-hidden="true"
    >
      <span className="flex">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className={cn(sizeClass, "text-muted-foreground/30")} />
        ))}
      </span>
      <span
        className="absolute inset-0 flex overflow-hidden"
        style={{ width: `${fillPercent}%` }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={cn(sizeClass, "shrink-0 fill-amber-400 text-amber-400")}
          />
        ))}
      </span>
    </span>
  );
}

/**
 * Average rating summary: stars + numeric average + count, e.g. "★ 4.5 (23)".
 * Renders nothing when the course has no ratings.
 */
export function CourseRating({
  average,
  count,
  size = "sm",
  className,
}: {
  average: number | null;
  count: number;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  if (count === 0 || average === null) return null;

  const label = `Rated ${average.toFixed(1)} out of 5 from ${count} ${
    count === 1 ? "rating" : "ratings"
  }`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground",
        className
      )}
      title={label}
      aria-label={label}
    >
      <StarRating value={average} size={size} />
      <span className="font-medium text-foreground">{average.toFixed(1)}</span>
      <span>({count})</span>
    </span>
  );
}
