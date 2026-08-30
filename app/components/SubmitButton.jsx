import { useEffect, useRef } from "react";

/**
 * Polaris s-button does not reliably deliver React onClick (custom element + React 18).
 * Listen on the host node and submit the nearest form.
 */
export function SubmitButton({ children, ...props }) {
  const ref = useRef(null);

  useEffect(() => {
    const btn = ref.current;
    if (!btn) return;
    const onClick = (event) => {
      event.preventDefault();
      const form = btn.closest("form");
      if (!form || typeof form.requestSubmit !== "function") return;
      form.requestSubmit();
    };
    btn.addEventListener("click", onClick);
    return () => btn.removeEventListener("click", onClick);
  }, []);

  return (
    <s-button ref={ref} type="button" {...props}>
      {children}
    </s-button>
  );
}
