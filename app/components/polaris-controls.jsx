/* eslint-disable react/prop-types */
import { useEffect, useRef } from "react";

// s-button does not reliably deliver React onClick under React 18.
function useHostEvent(ref, eventName, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const el = ref.current;
    if (!el || !eventName) return undefined;
    const listener = (event) => handlerRef.current?.(event);
    el.addEventListener(eventName, listener);
    return () => el.removeEventListener(eventName, listener);
  }, [eventName, ref]);
}

export function ClickButton({ onClick, children, ...props }) {
  const ref = useRef(null);
  useHostEvent(ref, "click", onClick);
  return (
    <s-button ref={ref} type="button" {...props}>
      {children}
    </s-button>
  );
}

export function Checkbox({ onChange, ...props }) {
  const ref = useRef(null);
  useHostEvent(ref, "change", onChange);
  return <s-checkbox ref={ref} {...props}></s-checkbox>;
}

export function NumberField({ onChange, ...props }) {
  const ref = useRef(null);
  useHostEvent(ref, "change", onChange);
  return <s-number-field ref={ref} {...props}></s-number-field>;
}

export function DateField({ onChange, ...props }) {
  const ref = useRef(null);
  useHostEvent(ref, "change", onChange);
  return <s-date-field ref={ref} {...props}></s-date-field>;
}

export function TextField({ onChange, onInput, onFocus, onBlur, ...props }) {
  const ref = useRef(null);
  useHostEvent(ref, "change", onChange);
  useHostEvent(ref, "input", onInput);
  useHostEvent(ref, "focusin", onFocus);
  useHostEvent(ref, "focusout", onBlur);
  return <s-text-field ref={ref} {...props}></s-text-field>;
}

export function SearchField({ onInput, ...props }) {
  const ref = useRef(null);
  useHostEvent(ref, "input", onInput);
  return <s-search-field ref={ref} {...props}></s-search-field>;
}
