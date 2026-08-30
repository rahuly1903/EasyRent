/* Rental picker: flatpickr + variant-aware availability. */
(function () {
  const RENT_FOR_NAME = /rent\s*for|duration/i;
  const DAY_VALUE = /(\d+)\s*-?\s*days?/i;
  const rangesCache = new Map();
  let flatpickrReady = new Promise((res) => {
    const check = () => (window.flatpickr ? res(window.flatpickr) : setTimeout(check, 50));
    check();
  });

  function boot() {
    document.querySelectorAll("[data-rental-picker]").forEach((root) => {
      if (root.dataset.rentalReady) return;
      root.dataset.rentalReady = "true";
      init(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  document.addEventListener("shopify:section:load", boot);

  async function init(root) {
    const proxyBase = root.getAttribute("data-proxy-base") || "/apps/rental";
    const shopDomain = root.getAttribute("data-shop");
    const productId = root.getAttribute("data-product-id");
    const config = loadConfig(root);
    const optionNames = config.optionNames;
    const liquidVariants = config.variants;
    const input = root.querySelector(".rental-picker__input");
    if (!input) return;
    const meta = root.querySelector("[data-rental-meta]");
    const errorEl = root.querySelector("[data-rental-error]");
    const form = root.querySelector("[data-rental-form]");
    const durationDisplay = root.querySelector("[data-rental-duration-display]");
    const endDisplay = root.querySelector("[data-rental-end-display]");
    const submit = root.querySelector("[data-rental-submit]");
    const startProp = root.querySelector("[data-rental-start-prop]");
    const endProp = root.querySelector("[data-rental-end-prop]");
    const durationProp = root.querySelector("[data-rental-duration-prop]");
    const depositProp = root.querySelector("[data-rental-deposit-prop]");
    const variantIdInput = root.querySelector("[data-rental-variant-id]");
    const msgUnavailable = root.getAttribute("data-msg-unavailable") || "Grey dates are unavailable because they overlap an existing booking.";
    const msgAvailable = root.getAttribute("data-msg-available") || "All dates available";
    const msgOverlap = root.getAttribute("data-msg-overlap") || "These dates overlap an existing booking. Choose another start date.";
    const msgAvailError = root.getAttribute("data-msg-availability-error") || "Could not check availability. Try again.";
    const msgDuration = root.getAttribute("data-msg-duration") || "Duration";
    const msgClear = root.getAttribute("data-msg-clear") || "Clear";
    const msgSave = root.getAttribute("data-msg-save") || "Save";
    const msgClose = root.getAttribute("data-msg-close") || "Close";
    const backdrop = root.querySelector("[data-rental-backdrop]");
    const sheet = root.querySelector("[data-rental-sheet]");
    const mobileQuery = window.matchMedia("(max-width: 749px)");

    const state = {
      variantId: null,
      duration: 1,
      start: null,
      end: null,
      ranges: [],
      bufferBefore: 0,
      bufferAfter: 0,
      availabilityError: false,
      clearedOverlap: false,
    };

    const flatpickr = await flatpickrReady;
    let picker = null;

    function dayTime(date) {
      const d = parseYmdLocal(date);
      return d.getTime();
    }

    function applyRangeClass(dayElem) {
      dayElem.classList.remove("selected", "startRange", "endRange", "inRange");
      if (!state.start || !dayElem.dateObj) return;
      if (dayElem.classList.contains("prevMonthDay") || dayElem.classList.contains("nextMonthDay")) return;
      const t = dayTime(dayElem.dateObj);
      const s = dayTime(state.start);
      const e = state.end ? dayTime(state.end) : s;
      if (t === s && t === e) dayElem.classList.add("selected");
      else if (t === s) dayElem.classList.add("selected", "startRange");
      else if (t === e) dayElem.classList.add("selected", "endRange");
      else if (t > s && t < e) dayElem.classList.add("inRange");
    }

    function labelMonths(fp) {
      const containers = fp.daysContainer?.querySelectorAll(".dayContainer");
      if (!containers?.length) return;
      containers.forEach((container, i) => {
        const d = new Date(fp.currentYear, fp.currentMonth + i, 1);
        container.setAttribute(
          "data-month-label",
          d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        );
      });
      const title = fp.calendarContainer.querySelector("[data-rental-month-title]");
      if (title) title.textContent = containers[0].getAttribute("data-month-label") || "";
    }

    function durationText() {
      return state.duration === 1 ? "1 day" : `${state.duration} days`;
    }

    function updateCalDuration(fp) {
      const el = fp?.calendarContainer?.querySelector("[data-rental-cal-duration]");
      if (el) el.textContent = durationText();
    }

    function setSheetOpen(open) {
      if (!backdrop) return;
      if (open && backdrop.parentElement !== document.body) {
        document.body.appendChild(backdrop);
      }
      backdrop.hidden = !open;
      backdrop.classList.toggle("is-open", open);
      document.body.classList.toggle("rental-picker-lock", open);
    }

    function injectChrome(fp, mobile) {
      const cal = fp.calendarContainer;
      if (cal.querySelector("[data-rental-cal-footer]")) return;

      if (mobile) {
        const bar = document.createElement("div");
        bar.className = "rental-picker-cal__mobile-bar";
        bar.innerHTML =
          `<button type="button" class="rental-picker-cal__close" data-rental-cal-close aria-label="${escapeAttr(msgClose)}">` +
          `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l8 8M10 2L2 10"/></svg>` +
          `</button>` +
          `<span class="rental-picker-cal__mobile-title" data-rental-month-title></span>`;
        cal.insertBefore(bar, cal.firstChild);
        bar.querySelector("[data-rental-cal-close]").addEventListener("click", () => fp.close());
      }

      const footer = document.createElement("div");
      footer.className = "rental-picker-cal__footer";
      footer.setAttribute("data-rental-cal-footer", "");
      footer.innerHTML =
        `<div class="rental-picker-cal__duration">` +
        `<span class="rental-picker-cal__duration-label">${escapeHtml(msgDuration)}</span>` +
        `<span class="rental-picker-cal__duration-pill" data-rental-cal-duration>${escapeHtml(durationText())}</span>` +
        `</div>` +
        `<div class="rental-picker-cal__actions">` +
        `<button type="button" class="rental-picker-cal__clear" data-rental-cal-clear>${escapeHtml(msgClear)}</button>` +
        `<button type="button" class="rental-picker-cal__save" data-rental-cal-save>${escapeHtml(msgSave)}</button>` +
        `</div>`;
      cal.appendChild(footer);
      footer.querySelector("[data-rental-cal-clear]").addEventListener("click", () => {
        fp.clear();
        state.start = null;
        state.end = null;
        state.clearedOverlap = false;
        validate();
      });
      footer.querySelector("[data-rental-cal-save]").addEventListener("click", () => fp.close());
    }

    function createPicker() {
      const mobile = mobileQuery.matches;
      const selected = picker?.selectedDates?.[0] || state.start;
      if (picker) {
        if (picker.altInput?.id) input.id = picker.altInput.id;
        picker.close();
        picker.destroy();
        picker = null;
      }
      if (sheet) sheet.replaceChildren();
      setSheetOpen(false);

      picker = flatpickr(input, {
        minDate: new Date().fp_incr(3),
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "F j, Y",
        altInputClass: "rental-picker__input",
        disableMobile: true,
        closeOnSelect: false,
        monthSelectorType: "dropdown",
        showMonths: mobile ? 12 : 1,
        appendTo: mobile && sheet ? sheet : undefined,
        position: mobile ? "auto" : "below",
        static: false,
        locale: { firstDayOfWeek: 0 },
        disable: [(date) => isStartBlocked(date)],
        onReady: (_d, _s, fp) => {
          fp.calendarContainer.classList.add("rental-picker-calendar");
          fp.calendarContainer.classList.toggle("rental-picker-calendar--mobile", mobile);
          if (fp.altInput && input.id) {
            fp.altInput.id = input.id;
            input.removeAttribute("id");
          }
          injectChrome(fp, mobile);
          labelMonths(fp);
          updateCalDuration(fp);
        },
        onOpen: (_d, _s, fp) => {
          if (mobile) {
            setSheetOpen(true);
            requestAnimationFrame(() => {
              fp.redraw();
              labelMonths(fp);
              fp.calendarContainer.querySelectorAll(".flatpickr-day").forEach(applyRangeClass);
            });
          } else {
            requestAnimationFrame(() => {
              fp.calendarContainer.scrollIntoView({ block: "center", inline: "nearest" });
            });
          }
          labelMonths(fp);
          updateCalDuration(fp);
        },
        onClose: () => {
          setSheetOpen(false);
        },
        onMonthChange: (_d, _s, fp) => labelMonths(fp),
        onYearChange: (_d, _s, fp) => labelMonths(fp),
        onDayCreate: (_dObj, _dStr, _fp, dayElem) => {
          if (isStartBlocked(dayElem.dateObj)) dayElem.title = msgOverlap;
          applyRangeClass(dayElem);
        },
        onChange: (dates) => {
          state.start = dates[0] || null;
          if (state.start) state.clearedOverlap = false;
          syncEndFromDuration();
          validate();
          if (picker) {
            picker.calendarContainer.querySelectorAll(".flatpickr-day").forEach(applyRangeClass);
            updateCalDuration(picker);
          }
        },
      });

      const visibleInput = picker.altInput || input;
      visibleInput.classList.add("rental-picker__input");
      if (selected) picker.setDate(selected, false);
      applyDisabledDates();
    }

    createPicker();
    if (mobileQuery.addEventListener) mobileQuery.addEventListener("change", createPicker);
    else mobileQuery.addListener(createPicker);

    if (backdrop) {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop && picker) picker.close();
      });
    }

    let applyGen = 0;
    async function applyVariant(v) {
      const gen = ++applyGen;
      const resolved = resolveVariant(v, liquidVariants) || v;
      if (!resolved) return;
      const opts = variantOptionMap(resolved, optionNames);
      const nextDuration =
        durationFromDom(root, optionNames) ||
        durationFromOptionMap(opts) ||
        durationFromTitle(resolved.title || resolved.name || resolved.public_title) ||
        1;
      const nextId = normalizeVariantId(resolved.id) || state.variantId;
      if (gen !== applyGen) return;
      const sameVariant = nextId === state.variantId;
      state.variantId = nextId;
      state.duration = nextDuration;
      if (variantIdInput && state.variantId) variantIdInput.value = state.variantId;
      if (durationProp) durationProp.value = String(state.duration);
      syncEndFromDuration();
      validate();
      if (!sameVariant || !state.ranges.length) await refreshRanges();
      else applyDisabledDates();
      if (gen !== applyGen) return;
      validate();
    }

    hookVariantChanges(root, variantIdInput, optionNames, liquidVariants, (v) => applyVariant(v));
    applyVariant(currentVariantFromPage(root, variantIdInput, liquidVariants));

    function isStartBlocked(date) {
      if (!date) return false;
      return windowOverlapsBlocked(
        date,
        state.duration,
        state.ranges,
        state.bufferBefore,
        state.bufferAfter,
      );
    }

    function applyDisabledDates() {
      if (!picker) return;
      picker.set("disable", [(date) => isStartBlocked(date)]);
      picker.redraw();
      labelMonths(picker);
      if (state.start && isStartBlocked(state.start)) {
        state.clearedOverlap = true;
        picker.clear();
        state.start = null;
        state.end = null;
      }
    }

    function markInputError(on) {
      const els = [input, picker?.altInput];
      els.forEach((el) => {
        if (!el) return;
        el.classList.toggle("is-error", on);
      });
    }

    function showError(message) {
      if (!errorEl) return;
      if (message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
        markInputError(true);
      } else {
        errorEl.textContent = "";
        errorEl.hidden = true;
        markInputError(false);
      }
    }

    function syncEndFromDuration() {
      if (state.start) state.end = addDays(state.start, state.duration - 1);
      else state.end = null;
    }

    async function refreshRanges() {
      if (!state.variantId) {
        state.ranges = [];
        state.availabilityError = true;
        applyDisabledDates();
        if (meta) meta.textContent = msgAvailError;
        return;
      }
      const key = `${productId}|${state.variantId}`;
      if (rangesCache.has(key)) {
        const cached = rangesCache.get(key);
        state.ranges = cached.ranges;
        state.bufferBefore = cached.bufferBefore;
        state.bufferAfter = cached.bufferAfter;
        state.availabilityError = false;
      } else {
        const params = new URLSearchParams({
          productId,
          variantId: state.variantId,
          shop: shopDomain,
        });
        try {
          const res = await fetch(`${proxyBase}/availability?${params}`, { credentials: "same-origin" });
          const json = await res.json();
          state.ranges = json.ranges || [];
          state.bufferBefore = Number(json.bufferBefore) || 0;
          state.bufferAfter = Number(json.bufferAfter) || 0;
          state.availabilityError = !res.ok;
          if (res.ok) {
            rangesCache.set(key, {
              ranges: state.ranges,
              bufferBefore: state.bufferBefore,
              bufferAfter: state.bufferAfter,
            });
          }
        } catch (e) {
          console.warn("availability fetch failed", e);
          state.ranges = [];
          state.availabilityError = true;
        }
      }
      applyDisabledDates();
      if (meta) {
        if (state.availabilityError) meta.textContent = msgAvailError;
        else meta.textContent = state.ranges.length ? msgUnavailable : msgAvailable;
      }
    }

    function validate() {
      const overlapping = !!(state.start && isStartBlocked(state.start));
      const ok =
        !!state.start &&
        !!state.end &&
        !overlapping &&
        !state.availabilityError;
      if (submit) submit.disabled = !ok;
      if (durationProp) durationProp.value = String(state.duration);
      if (state.start && startProp) startProp.value = ymd(state.start);
      else if (startProp) startProp.value = "";
      if (state.end && endProp) endProp.value = ymd(state.end);
      else if (endProp) endProp.value = "";
      if (depositProp) depositProp.value = depositPropertyValue(state.variantId, config);
      if (durationDisplay) durationDisplay.textContent = durationText();
      updateCalDuration(picker);
      if (endDisplay) endDisplay.textContent = state.end ? ymd(state.end) : "—";
      if (overlapping || state.clearedOverlap) showError(msgOverlap);
      else if (state.availabilityError) showError(msgAvailError);
      else showError("");
    }

    if (form) {
      form.addEventListener("submit", (e) => {
        if (!state.start || isStartBlocked(state.start) || state.availabilityError) {
          e.preventDefault();
          showError(state.availabilityError ? msgAvailError : msgOverlap);
        }
      });
    }

    function readVariant(id) {
      const nid = normalizeVariantId(id);
      if (!nid) return null;
      const fromLiquid = liquidVariants.find((v) => normalizeVariantId(v.id) === nid);
      if (fromLiquid) return fromLiquid;
      const p = window.ShopifyAnalytics?.meta?.product;
      return p?.variants?.find((v) => normalizeVariantId(v.id) === nid) || null;
    }

    function resolveVariant(v, list) {
      if (!v) return null;
      if (v.selectedOptions?.length || (Array.isArray(v.options) && v.options.length) || v.option1 != null) {
        return v;
      }
      return readVariant(v.id) || v;
    }

    function currentVariantFromPage(pickerRoot, ownIdInput, list) {
      const themeId = readThemeVariantId(pickerRoot, ownIdInput);
      const ownId = ownIdInput?.value;
      return readVariant(themeId) || readVariant(ownId) || { id: themeId || ownId, options: [] };
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  function loadConfig(root) {
    const el = root.querySelector("[data-rental-config]");
    const fromScript = safeJson(el?.textContent);
    if (fromScript) {
      return {
        optionNames: normalizeOptionNames(fromScript.optionNames),
        variants: fromScript.variants || [],
        securityDeposit: parseMoneyAmount(fromScript.securityDeposit),
        moneyFormat: fromScript.moneyFormat || "${{amount}}",
      };
    }
    return {
      optionNames: normalizeOptionNames(safeJson(root.getAttribute("data-option-names"))),
      variants: safeJson(root.getAttribute("data-variants")) || [],
      securityDeposit: parseMoneyAmount(root.getAttribute("data-security-deposit")),
      moneyFormat: root.getAttribute("data-money-format") || "${{amount}}",
    };
  }

  function normalizeOptionNames(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => (typeof item === "string" ? item : item?.name)).filter(Boolean);
  }

  function safeJson(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function parseMoneyAmount(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "object" && value.amount != null) {
      const parsed = Number(value.amount);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function variantPrice(variant) {
    const raw = Number(variant?.price);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw / 100;
  }

  function depositAmountForVariant(variantId, config) {
    const fromMetafield = config?.securityDeposit;
    if (fromMetafield != null) {
      return fromMetafield > 0 ? Math.round(fromMetafield * 100) / 100 : 0;
    }
    const variant = (config?.variants || []).find((item) => normalizeVariantId(item.id) === normalizeVariantId(variantId));
    const price = variantPrice(variant);
    if (!(price > 0)) return 0;
    return Math.round(price * 0.7);
  }

  function formatMoney(amount, format) {
    const value = Number(amount).toFixed(2);
    const template = format || "${{amount}}";
    if (template.indexOf("{{amount") === -1) return value;
    return template
      .replace(/\{\{\s*amount_no_decimals\s*\}\}/g, String(Math.round(amount)))
      .replace(/\{\{\s*amount_with_comma_separator\s*\}\}/g, value.replace(".", ","))
      .replace(/\{\{\s*amount\s*\}\}/g, value);
  }

  function depositPropertyValue(variantId, config) {
    const amount = depositAmountForVariant(variantId, config);
    if (!(amount > 0)) return "";
    return formatMoney(amount, config?.moneyFormat);
  }

  function normalizeVariantId(id) {
    if (id == null || id === "") return "";
    const s = String(id);
    const m = /ProductVariant\/(\d+)/.exec(s);
    return m ? m[1] : s;
  }

  function variantOptionMap(variant, optionNames) {
    const map = new Map();
    if (!variant) return map;
    if (variant.selectedOptions?.length) {
      for (const o of variant.selectedOptions) map.set((o.name || "").toString(), (o.value || "").toString());
    } else if (Array.isArray(variant.options) && optionNames.length) {
      variant.options.forEach((val, i) => {
        const name = optionNames[i] || `Option ${i + 1}`;
        map.set(name, String(val));
      });
    } else {
      ["option1", "option2", "option3"].forEach((key, i) => {
        if (variant[key] == null) return;
        const name = optionNames[i] || key;
        map.set(name, String(variant[key]));
      });
    }
    return map;
  }

  function findOptionValue(map, re) {
    for (const [name, value] of map) if (re.test(name)) return value;
    return null;
  }

  function durationFromOptionMap(map) {
    const named = parseDuration(findOptionValue(map, RENT_FOR_NAME));
    if (named) return named;
    for (const [, value] of map) {
      const d = parseDuration(value);
      if (d && DAY_VALUE.test(String(value))) return d;
    }
    return null;
  }

  function durationFromTitle(title) {
    if (!title) return null;
    const m = DAY_VALUE.exec(String(title));
    return m ? Number(m[1]) : null;
  }

  function durationFromDom(root, optionNames) {
    const rentForName = optionNames.find((n) => RENT_FOR_NAME.test(n));
    if (rentForName) {
      const fromNamed = readOptionInputValue(rentForName);
      const parsed = parseDuration(fromNamed) || parseDuration(selectedOptionLabel(rentForName));
      if (parsed) return parsed;
    }
    for (const fs of document.querySelectorAll("fieldset")) {
      const legend = fs.querySelector("legend");
      if (!legend || !RENT_FOR_NAME.test(legend.textContent || "")) continue;
      const chosen = fs.querySelector("input:checked, option:checked, select");
      if (!chosen) continue;
      const parsed =
        parseDuration(chosen.value) ||
        parseDuration(chosen.textContent) ||
        parseDuration(chosen.closest("label")?.textContent);
      if (parsed) return parsed;
    }
    const controls = document.querySelectorAll(
      'form[action*="/cart/add"] select, form[action*="/cart/add"] input[type="radio"]:checked',
    );
    for (const el of controls) {
      if (el.closest("[data-rental-form]") || (root && el.closest("[data-rental-picker]") === root && el.matches("[data-rental-variant-id]"))) continue;
      const candidates = [el.value, el.selectedOptions?.[0]?.textContent, el.closest("label")?.textContent];
      for (const candidate of candidates) {
        if (candidate && DAY_VALUE.test(String(candidate))) {
          const parsed = parseDuration(candidate);
          if (parsed) return parsed;
        }
      }
    }
    return null;
  }

  function selectedOptionLabel(optionName) {
    const names = [`options[${optionName}]`, optionName];
    for (const name of names) {
      const escaped = cssAttr(name);
      const select = document.querySelector(`select[name="${escaped}"]`);
      if (select?.selectedOptions?.[0]) return select.selectedOptions[0].textContent;
      const radio = document.querySelector(`input[type="radio"][name="${escaped}"]:checked`);
      if (radio) return radio.closest("label")?.textContent || radio.getAttribute("value");
    }
    return null;
  }

  function readOptionInputValue(optionName) {
    const names = [`options[${optionName}]`, optionName];
    for (const name of names) {
      const escaped = cssAttr(name);
      const select = document.querySelector(`select[name="${escaped}"]`);
      if (select && select.value) return select.value;
      const radio = document.querySelector(`input[type="radio"][name="${escaped}"]:checked`);
      if (radio) return radio.value;
      const hidden = document.querySelector(`input[type="hidden"][name="${escaped}"]`);
      if (hidden && hidden.value) return hidden.value;
    }
    return null;
  }

  function cssAttr(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function parseDuration(v) {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    if (!s || /gid:\/\//i.test(s)) return null;
    const day = DAY_VALUE.exec(s);
    if (day) return Number(day[1]);
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return n > 0 && n <= 365 ? n : null;
    }
    return null;
  }

  function addDays(date, days) {
    const d = parseYmdLocal(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function ymd(date) {
    const d = parseYmdLocal(date);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function parseYmdLocal(input) {
    if (input instanceof Date) {
      return new Date(input.getFullYear(), input.getMonth(), input.getDate());
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(input || ""));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return new Date(NaN);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function windowOverlapsBlocked(start, duration, ranges, bufferBefore, bufferAfter) {
    const days = Math.max(1, Number(duration) || 1);
    const rentalStart = parseYmdLocal(start);
    const rentalEnd = addDays(rentalStart, days - 1);
    const blockStart = addDays(rentalStart, -Math.max(0, bufferBefore | 0));
    const blockEnd = addDays(rentalEnd, Math.max(0, bufferAfter | 0));
    const s = blockStart.getTime();
    const e = blockEnd.getTime();
    for (const r of ranges || []) {
      const rf = parseYmdLocal(r.from).getTime();
      const rt = parseYmdLocal(r.to).getTime();
      if (rf <= e && rt >= s) return true;
    }
    return false;
  }

  function readThemeVariantId(root, ownIdInput) {
    const inputs = document.querySelectorAll('form[action*="/cart/add"] [name="id"], select[name="id"]');
    for (const el of inputs) {
      if (ownIdInput && el === ownIdInput) continue;
      if (el.hasAttribute("data-rental-variant-id")) continue;
      if (root && el.closest("[data-rental-picker]") === root) continue;
      if (el.closest("[data-rental-form]")) continue;
      if (el.value) return el.value;
    }
    return ownIdInput?.value || "";
  }

  function hookVariantChanges(root, ownIdInput, optionNames, liquidVariants, cb) {
    let lastKey = "";

    function lookup(id) {
      const nid = normalizeVariantId(id);
      const raw = liquidVariants.find((x) => normalizeVariantId(x.id) === nid);
      const p = window.ShopifyAnalytics?.meta?.product;
      return raw || p?.variants?.find((x) => normalizeVariantId(x.id) === nid) || { id, options: [] };
    }

    function tick(preferredVariant) {
      const id = normalizeVariantId(preferredVariant?.id) || readThemeVariantId(root, ownIdInput);
      const durationHint = durationFromDom(root, optionNames) || "";
      const key = `${id}|${durationHint}`;
      if (key === lastKey) return;
      lastKey = key;
      const v = preferredVariant && (preferredVariant.options || preferredVariant.option1 != null || preferredVariant.selectedOptions)
        ? preferredVariant
        : lookup(id);
      cb(v);
    }

    document.addEventListener("variant:change", (e) => {
      const v = e.detail?.variant || e.detail?.currentVariant;
      if (v && v.id) tick(v);
      else tick();
    });

    document.addEventListener(
      "change",
      (e) => {
        const t = e.target;
        if (!t || typeof t.matches !== "function") return;
        if (
          t.matches('[name="id"], [name^="options"], input[type="radio"], select') ||
          t.closest("variant-selects, variant-radios, product-info, product-form, picker-field")
        ) {
          tick();
        }
      },
      true,
    );

    document.addEventListener(
      "click",
      (e) => {
        const t = e.target;
        if (t?.closest?.("variant-selects, variant-radios, product-info, product-form, picker-field")) {
          setTimeout(() => tick(), 50);
        }
      },
      true,
    );

    setTimeout(tick, 0);
    setInterval(() => tick(), 300);
  }
})();
