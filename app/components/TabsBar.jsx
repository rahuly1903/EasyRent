import { useEffect, useRef } from "react";

export function TabsBar({ tabs = [], activeTab, onTabChange }) {
  return (
    <s-box padding="small-200">
      <s-stack direction="inline" gap="small-200">
        {tabs.map((t) => (
          <TabButton
            key={t.value}
            active={activeTab === t.value}
            onSelect={() => onTabChange && onTabChange(t.value)}
          >
            {t.label}
          </TabButton>
        ))}
      </s-stack>
    </s-box>
  );
}

function TabButton({ active, onSelect, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const btn = ref.current;
    if (!btn) return;
    const onClick = () => onSelect();
    btn.addEventListener("click", onClick);
    return () => btn.removeEventListener("click", onClick);
  }, [onSelect]);

  return (
    <s-button ref={ref} variant={active ? "primary" : "tertiary"}>
      {children}
    </s-button>
  );
}
