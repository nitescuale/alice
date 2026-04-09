import { type HTMLAttributes, type ReactNode } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  variant?: "default" | "amber" | "success" | "danger" | "info";
  size?: "sm" | "md";
  className?: string;
}

const variantClass: Record<string, string> = {
  default: "alice-badge--default",
  amber: "alice-badge--amber",
  success: "alice-badge--success",
  danger: "alice-badge--danger",
  info: "alice-badge--info",
};

export function Badge({ children, variant = "default", size = "sm", className = "", ...props }: BadgeProps) {
  return (
    <span className={`alice-badge ${variantClass[variant]} alice-badge--${size} ${className}`} {...props}>
      {children}
    </span>
  );
}
