import { type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
  children: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  primary: "alice-btn--primary",
  secondary: "alice-btn--secondary",
  ghost: "alice-btn--ghost",
  danger: "alice-btn--danger",
};

const sizeStyles: Record<Size, string> = {
  sm: "alice-btn--sm",
  md: "alice-btn--md",
  lg: "alice-btn--lg",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`alice-btn ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="alice-btn__spinner" />
      ) : icon ? (
        <span className="alice-btn__icon">{icon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}
