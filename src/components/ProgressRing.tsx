interface ProgressRingProps {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  className?: string;
}

export function ProgressRing({
  value,
  size = 100,
  strokeWidth = 8,
  color = "var(--amber-500)",
  trackColor = "var(--noir-700)",
  label,
  className = "",
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  // Determine color based on score
  let scoreColor = color;
  if (value >= 80) scoreColor = "var(--success-500)";
  else if (value >= 50) scoreColor = "var(--amber-500)";
  else scoreColor = "var(--danger-500)";

  return (
    <div className={`progress-ring ${className}`} style={{ width: size, height: size }}>
      <svg className="progress-ring__svg" width={size} height={size}>
        <circle
          className="progress-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={trackColor}
        />
        <circle
          className="progress-ring__fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={scoreColor}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      {label && (
        <span
          className="progress-ring__label"
          style={{ fontSize: size * 0.22 }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
