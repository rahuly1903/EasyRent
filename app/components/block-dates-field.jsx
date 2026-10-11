/* eslint-disable react/prop-types */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatBlockDates, parseBlockDates } from "../lib/rental-settings";
import { TextField } from "./polaris-controls";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const calendarStyle = {
  position: "fixed",
  zIndex: 1000,
  boxSizing: "border-box",
  width: 292,
  padding: "12px 12px 8px",
  background: "#fff",
  border: "1px solid #e3e3e3",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
  color: "#202223",
  fontFamily: "Inter, sans-serif",
};

const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 4,
  marginBottom: 8,
};

const navStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "#202223",
  cursor: "pointer",
};

const selectsStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const selectStyle = {
  border: 0,
  background: "transparent",
  color: "#202223",
  font: "inherit",
  fontSize: 14,
  fontWeight: 650,
  cursor: "pointer",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 36px)",
  justifyContent: "space-between",
};

const weekdayStyle = {
  height: 28,
  color: "#6d7175",
  fontSize: 12,
  lineHeight: "28px",
  textAlign: "center",
};

export function BlockDatesField({ dates, onChange }) {
  const selected = Array.isArray(dates) ? dates : [];
  const rootRef = useRef(null);
  const calendarRef = useRef(null);
  const openRef = useRef(false);
  const writingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [hover, setHover] = useState("");
  const [view, setView] = useState(() => viewFor(selected));
  const [position, setPosition] = useState(null);
  const display = draft ?? formatBlockDates(selected);
  const selectedKey = selected.join(",");
  const closeCalendar = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    setDraft(null);
    setHover("");
    setPosition(null);
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    function place() {
      const field = rootRef.current;
      if (!field) return;
      const rect = field.getBoundingClientRect();
      const width = 292;
      const height = calendarRef.current?.offsetHeight || 320;
      const below = window.innerHeight - rect.bottom;
      const top = below < height && rect.top > below ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPosition((current) => {
        if (current && current.top === top && current.left === left) return current;
        return { top, left };
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, view.year, view.month, selectedKey]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      const target = event.target;
      if (rootRef.current?.contains(target) || calendarRef.current?.contains(target)) return;
      closeCalendar();
    }
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      closeCalendar();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeCalendar]);

  function showCalendar() {
    if (!openRef.current) setView(viewFor(selected));
    openRef.current = true;
    setOpen(true);
  }

  function applyText(event) {
    if (writingRef.current) return;
    const value = fieldValue(event);
    setDraft(value);
    onChange(parseBlockDates(value));
  }

  function handleBlur(event) {
    const next = event.relatedTarget;
    if (next && (rootRef.current?.contains(next) || calendarRef.current?.contains(next))) return;
    setDraft(null);
    if (next) closeCalendar();
  }

  function toggleDate(iso) {
    const next = selected.includes(iso) ? selected.filter((item) => item !== iso) : [...selected, iso];
    writingRef.current = true;
    setDraft(null);
    onChange(parseBlockDates(next));
    setTimeout(() => {
      writingRef.current = false;
    }, 0);
  }

  const years = yearOptions(selected, view.year);
  const cells = buildCells(view.year, view.month);

  return (
    <div ref={rootRef}>
      <TextField
        label="Block Dates"
        placeholder="YYYY/MM/DD, YYYY/MM/DD"
        value={display}
        onInput={applyText}
        onChange={applyText}
        onFocus={showCalendar}
        onBlur={handleBlur}
      ></TextField>
      {open
        ? createPortal(
            <div
              ref={calendarRef}
              role="dialog"
              aria-label="Choose block dates"
              style={{
                ...calendarStyle,
                top: position?.top ?? -9999,
                left: position?.left ?? 0,
                visibility: position ? "visible" : "hidden",
              }}
            >
              <div style={headerStyle}>
                <button
                  type="button"
                  aria-label="Previous month"
                  style={navStyle}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => shiftView(view, -1, setView)}
                >
                  <Chevron direction="left" />
                </button>
                <div style={selectsStyle}>
                  <select
                    aria-label="Month"
                    value={view.month}
                    style={selectStyle}
                    onChange={(event) => setView((current) => ({ ...current, month: Number(event.target.value) }))}
                  >
                    {MONTHS.map((month, index) => (
                      <option key={month} value={index}>
                        {month}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Year"
                    value={view.year}
                    style={selectStyle}
                    onChange={(event) => setView((current) => ({ ...current, year: Number(event.target.value) }))}
                  >
                    {years.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  aria-label="Next month"
                  style={navStyle}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => shiftView(view, 1, setView)}
                >
                  <Chevron direction="right" />
                </button>
              </div>
              <div style={gridStyle}>
                {WEEKDAYS.map((day) => (
                  <div key={day} style={weekdayStyle}>
                    {day}
                  </div>
                ))}
              </div>
              <div style={gridStyle}>
                {cells.map((cell) => {
                  const active = selected.includes(cell.iso);
                  const hot = hover === cell.iso;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      aria-pressed={active}
                      aria-label={cell.iso.replace(/-/g, "/")}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHover(cell.iso)}
                      onMouseLeave={() => setHover("")}
                      onClick={() => toggleDate(cell.iso)}
                      style={dayStyle(active, hot, cell.outside)}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function dayStyle(active, hot, outside) {
  return {
    width: 36,
    height: 36,
    margin: 0,
    padding: 0,
    border: 0,
    borderRadius: "50%",
    background: active ? "#202223" : hot ? "#f1f2f3" : "transparent",
    color: active ? "#fff" : outside ? "#b5b5b5" : "#202223",
    font: "inherit",
    fontSize: 13,
    lineHeight: "36px",
    textAlign: "center",
    cursor: "pointer",
  };
}

function viewFor(dates) {
  const iso = dates[0];
  if (iso) {
    const [year, month] = iso.split("-").map(Number);
    if (year && month) return { year, month: month - 1 };
  }
  const today = new Date();
  return { year: today.getFullYear(), month: today.getMonth() };
}

function yearOptions(dates, viewYear) {
  const now = new Date().getFullYear();
  const fromDates = dates.map((iso) => Number(iso.slice(0, 4))).filter(Number.isFinite);
  const min = Math.min(now - 1, viewYear, ...(fromDates.length ? fromDates : [viewYear]));
  const max = Math.max(now + 5, viewYear, ...(fromDates.length ? fromDates : [viewYear]));
  const years = [];
  for (let year = min; year <= max; year += 1) years.push(year);
  return years;
}

function shiftView(view, delta, setView) {
  const next = new Date(view.year, view.month + delta, 1);
  setView({ year: next.getFullYear(), month: next.getMonth() });
}

function buildCells(year, month) {
  const gridStart = new Date(year, month, 1 - new Date(year, month, 1).getDay());
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const iso = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    return { iso, day: date.getDate(), outside: date.getMonth() !== month };
  });
  while (cells.length > 28 && cells.slice(-7).every((cell) => cell.outside)) cells.splice(-7, 7);
  return cells;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function fieldValue(event) {
  const target = event.currentTarget || event.target;
  return target?.value ?? "";
}

function Chevron({ direction }) {
  const left = direction === "left";
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d={left ? "M12.5 4.5 7 10l5.5 5.5" : "M7.5 4.5 13 10l-5.5 5.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
