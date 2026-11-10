/** A point on the dial's rim, `degrees` clockwise from twelve o'clock. */
function rim(degrees: number, radius: number): string {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return `${(16 + radius * Math.cos(radians)).toFixed(3)} ${(16 + radius * Math.sin(radians)).toFixed(3)}`;
}

interface ClockDialProps {
  segments: number;
  filled: number;
  /** Rendered size in pixels. */
  size?: number;
  /** What a screen reader says; without one the dial is decorative and the text beside it does the telling. */
  label?: string;
}

/**
 * A progress clock: a circle cut into segments, filled clockwise from twelve.
 * A full clock is drawn in the alarm colour. Colours come from `--dial-*`
 * custom properties, so a card can tint the dial it holds.
 */
export function ClockDial({ segments, filled, size = 40, label }: ClockDialProps) {
  const count = Math.min(Math.max(Math.round(segments), 1), 24);
  const done = Math.min(Math.max(Math.round(filled), 0), count);
  const radius = 15;
  const step = 360 / count;

  return (
    <svg
      className={done >= count ? 'dial is-full' : 'dial'}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {count === 1 ? (
        <circle className={done === 1 ? 'dial__segment is-filled' : 'dial__segment'} cx="16" cy="16" r={radius} />
      ) : (
        Array.from({ length: count }, (_, index) => (
          <path
            key={index}
            className={index < done ? 'dial__segment is-filled' : 'dial__segment'}
            d={`M16 16L${rim(index * step, radius)}A${radius} ${radius} 0 ${step > 180 ? 1 : 0} 1 ${rim((index + 1) * step, radius)}Z`}
          />
        ))
      )}
      <circle className="dial__rim" cx="16" cy="16" r={radius} />
    </svg>
  );
}
