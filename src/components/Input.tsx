import { type InputHTMLAttributes, type ReactNode, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, icon, className = "", id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);
    return (
      <div className={`alice-input-group ${error ? "alice-input-group--error" : ""} ${className}`}>
        {label && (
          <label htmlFor={inputId} className="alice-input-group__label">
            {label}
          </label>
        )}
        <div className="alice-input-wrapper">
          {icon && <span className="alice-input-wrapper__icon">{icon}</span>}
          <input
            ref={ref}
            id={inputId}
            className={`alice-input ${icon ? "alice-input--has-icon" : ""}`}
            {...props}
          />
        </div>
        {hint && !error && <span className="alice-input-group__hint">{hint}</span>}
        {error && <span className="alice-input-group__error">{error}</span>}
      </div>
    );
  },
);

Input.displayName = "Input";
