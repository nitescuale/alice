import { type HTMLAttributes, type ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: "default" | "outlined" | "elevated" | "amber";
  padding?: "none" | "sm" | "md" | "lg";
}

const variantClass: Record<string, string> = {
  default: "alice-card--default",
  outlined: "alice-card--outlined",
  elevated: "alice-card--elevated",
  amber: "alice-card--amber",
};

const paddingClass: Record<string, string> = {
  none: "",
  sm: "alice-card--pad-sm",
  md: "alice-card--pad-md",
  lg: "alice-card--pad-lg",
};

export function Card({
  children,
  variant = "default",
  padding = "md",
  className = "",
  ...props
}: CardProps) {
  return (
    <div
      className={`alice-card ${variantClass[variant]} ${paddingClass[padding]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`alice-card__header ${className}`}>{children}</div>;
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`alice-card__body ${className}`}>{children}</div>;
}
