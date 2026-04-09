import { type SelectHTMLAttributes, type ReactNode } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  icon?: ReactNode;
}

export function Select({
  label,
  options,
  placeholder,
  icon,
  className = "",
  id,
  ...props
}: SelectProps) {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);
  return (
    <div className={`alice-select-group ${className}`}>
      {label && (
        <label htmlFor={selectId} className="alice-input-group__label">
          {label}
        </label>
      )}
      <div className="alice-input-wrapper">
        {icon && <span className="alice-input-wrapper__icon">{icon}</span>}
        <select
          id={selectId}
          className={`alice-select ${icon ? "alice-select--has-icon" : ""}`}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
