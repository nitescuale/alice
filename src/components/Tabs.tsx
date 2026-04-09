import { type ReactNode, useState } from "react";

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  onChange?: (id: string) => void;
  children: (activeTab: string) => ReactNode;
  className?: string;
}

export function Tabs({ tabs, defaultTab, onChange, children, className = "" }: TabsProps) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.id || "");

  function handleChange(id: string) {
    setActive(id);
    onChange?.(id);
  }

  return (
    <div className={`alice-tabs ${className}`}>
      <div className="alice-tabs__list" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active === tab.id}
            className={`alice-tabs__trigger ${active === tab.id ? "alice-tabs__trigger--active" : ""}`}
            onClick={() => handleChange(tab.id)}
          >
            {tab.icon && <span className="alice-tabs__icon">{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
      </div>
      <div className="alice-tabs__content" role="tabpanel">
        {children(active)}
      </div>
    </div>
  );
}
