/* Rental picker: flatpickr + variant-aware availability. */
(function () {
  const RENT_FOR_NAME = /rent\s*for|duration/i;
  const DAY_VALUE = /(\d+)\s*-?\s*days?/i;
  const SETTINGS_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
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
    const settings = normalizeRentalSettings(config.rentalSettings);
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
    const datesProp = root.querySelector("[data-rental-dates-prop]");
    const depositProp = root.querySelector("[data-rental-deposit-prop]");
    const depositDisplay = root.querySelector("[data-rental-deposit-display]");
    const variantIdInput = root.querySelector("[data-rental-variant-id]");
    const msgUnavailable = root.getAttribute("data-msg-unavailable") || "Grey dates are unavailable because they overlap an existing booking.";
    const msgAvailable = root.getAttribute("data-msg-available") || "All dates available";
    const msgOverlap = root.getAttribute("data-msg-overlap") || "This rental includes a date that is not available. Choose another start date.";
    const msgAvailError = root.getAttribute("data-msg-availability-error") || "Could not check availability. Try again.";
    const msgDuration = root.getAttribute("data-msg-duration") || "Duration";
    const msgClear = root.getAttribute("data-msg-clear") || "Clear";
    const msgSave = root.getAttribute("data-msg-save") || "Save";
    const msgClose = root.getAttribute("data-msg-close") || "Close";
    const msgDepositMissing = root.getAttribute("data-msg-deposit-missing") || "No security deposit variant is priced at {{amount}}.";
    const msgDepositProduct = root.getAttribute("data-msg-deposit-product") || "Choose a security deposit product in the rental picker settings.";
    const msgCartError = root.getAttribute("data-msg-cart-error") || "Could not add the rental to the cart. Try again.";
    const backdrop = root.querySelector("[data-rental-backdrop]");
    const sheet = root.querySelector("[data-rental-sheet]");
    const mobileQuery = window.matchMedia("(max-width: 749px)");

    const state = {
      variantId: null,
      duration: 1,
      start: null,
      end: null,
      dates: [],
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
      if (settings.bookingType === "multiple") return;
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
        state.dates = [];
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

      const bounds = calendarBounds(settings);
      picker = flatpickr(input, {
        mode: pickerMode(settings.bookingType),
        minDate: bounds.min,
        maxDate: bounds.max,
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
        disable: [(date) => isDayDisabled(date)],
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
          applyPickedDates(dates);
          state.clearedOverlap = false;
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
      if (settings.bookingType === "single") {
        state.duration = nextDuration;
        syncEndFromDuration();
      }
      if (variantIdInput && state.variantId) variantIdInput.value = state.variantId;
      if (durationProp) durationProp.value = String(state.duration);
      validate();
      if (!sameVariant || !state.ranges.length) await refreshRanges();
      else applyDisabledDates();
      if (gen !== applyGen) return;
      validate();
    }

    hookVariantChanges(root, variantIdInput, optionNames, liquidVariants, (v) => applyVariant(v));
    applyVariant(currentVariantFromPage(root, variantIdInput, liquidVariants));

    function applyPickedDates(dates) {
      const sorted = (dates || []).slice().sort((a, b) => dayTime(a) - dayTime(b));
      if (settings.bookingType === "multiple") {
        state.dates = sorted;
        state.start = sorted[0] || null;
        state.end = sorted[sorted.length - 1] || null;
        state.duration = Math.max(1, sorted.length);
        return;
      }
      state.dates = [];
      if (settings.bookingType === "range") {
        state.start = sorted[0] || null;
        state.end = sorted[1] || null;
        if (state.start && state.end) state.duration = inclusiveDays(state.start, state.end);
        return;
      }
      state.start = sorted[0] || null;
      syncEndFromDuration();
    }

    function inclusiveDays(start, end) {
      return Math.max(1, Math.round((dayTime(end) - dayTime(start)) / 86400000) + 1);
    }

    function weekdayAllowed(date, role) {
      const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const flags = settings.weekdays[keys[date.getDay()]];
      if (!flags) return true;
      return flags[role] !== false;
    }

    function isBlockedDate(date) {
      return settings.blockDates.has(ymd(date));
    }

    function rangeHasBlockedDate(start, end) {
      const days = inclusiveDays(start, end);
      for (let i = 0; i < days; i += 1) {
        if (isBlockedDate(addDays(start, i))) return true;
      }
      return false;
    }

    function outsideWindow(date) {
      if (!date) return false;
      const bounds = calendarBounds(settings);
      const time = dayTime(date);
      return time < dayTime(bounds.min) || time > dayTime(bounds.max);
    }

    function isDayDisabled(date) {
      if (!date) return false;
      if (outsideWindow(date)) return true;
      if (settings.bookingType === "range" && state.start && !state.end) {
        if (dayTime(date) < dayTime(state.start)) return true;
        if (dayTime(date) === dayTime(state.start)) return isBlockedDate(date) || !weekdayAllowed(date, "start");
        if (!weekdayAllowed(date, "end") || isBlockedDate(date)) return true;
        if (rangeHasBlockedDate(state.start, date)) return true;
        return windowOverlapsBlocked(
          state.start,
          inclusiveDays(state.start, date),
          state.ranges,
          state.bufferBefore,
          state.bufferAfter,
        );
      }
      if (settings.bookingType === "multiple") {
        return (
          isBlockedDate(date) ||
          !weekdayAllowed(date, "start") ||
          windowOverlapsBlocked(date, 1, state.ranges, state.bufferBefore, state.bufferAfter)
        );
      }
      return isBlockedDate(date) || !weekdayAllowed(date, "start") || isStartBlocked(date);
    }

    function selectionInvalid() {
      const chosen = settings.bookingType === "multiple" ? state.dates : [state.start, state.end];
      if (chosen.some((date) => date && outsideWindow(date))) return true;
      if (settings.bookingType === "multiple") {
        if (!state.dates.length) return false;
        return state.dates.some(
          (date) =>
            isBlockedDate(date) ||
            !weekdayAllowed(date, "start") ||
            windowOverlapsBlocked(date, 1, state.ranges, state.bufferBefore, state.bufferAfter),
        );
      }
      if (settings.bookingType === "range") {
        if (!state.start || !state.end) return false;
        if (isBlockedDate(state.start) || !weekdayAllowed(state.start, "start")) return true;
        if (isBlockedDate(state.end) || !weekdayAllowed(state.end, "end")) return true;
        if (rangeHasBlockedDate(state.start, state.end)) return true;
        return windowOverlapsBlocked(
          state.start,
          inclusiveDays(state.start, state.end),
          state.ranges,
          state.bufferBefore,
          state.bufferAfter,
        );
      }
      if (!state.start) return false;
      return (
        isBlockedDate(state.start) ||
        !weekdayAllowed(state.start, "start") ||
        isStartBlocked(state.start) ||
        rentalWindowHitsBlockDate(state.start)
      );
    }

    function rentalWindowHitsBlockDate(start) {
      if (!start) return false;
      const days = Math.max(1, Number(state.duration) || 1);
      return rangeHasBlockedDate(start, addDays(start, days - 1));
    }

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
      const bounds = calendarBounds(settings);
      picker.set("minDate", bounds.min);
      picker.set("maxDate", bounds.max);
      picker.set("disable", [(date) => isDayDisabled(date)]);
      picker.redraw();
      labelMonths(picker);
      if (selectionInvalid()) {
        state.clearedOverlap = true;
        picker.clear();
        state.start = null;
        state.end = null;
        state.dates = [];
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
      const overlapping = selectionInvalid();
      const complete = settings.bookingType === "multiple" ? state.dates.length > 0 : !!state.start && !!state.end;
      const ok = complete && !overlapping && !state.availabilityError;
      if (submit) submit.disabled = !ok;
      if (durationProp) durationProp.value = String(state.duration);
      if (state.start && startProp) startProp.value = ymd(state.start);
      else if (startProp) startProp.value = "";
      if (state.end && endProp) endProp.value = ymd(state.end);
      else if (endProp) endProp.value = "";
      if (datesProp) {
        datesProp.value =
          settings.bookingType === "multiple" ? state.dates.map((date) => ymd(date)).join(",") : "";
      }
      if (depositProp) depositProp.value = depositPropertyValue(state.variantId, config);
      if (depositDisplay) {
        const amount = depositAmountForVariant(state.variantId, config);
        depositDisplay.textContent = amount > 0 ? formatMoney(amount, config.moneyFormat) : "—";
      }
      if (durationDisplay) durationDisplay.textContent = durationText();
      updateCalDuration(picker);
      if (endDisplay) {
        if (settings.bookingType === "multiple" && state.dates.length) {
          endDisplay.textContent = state.dates.map((date) => ymd(date)).join(", ");
        } else {
          endDisplay.textContent = state.end ? ymd(state.end) : "—";
        }
      }
      if (overlapping || state.clearedOverlap) showError(msgOverlap);
      else if (state.availabilityError) showError(msgAvailError);
      else showError("");
    }

    let adding = false;
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        addRentalAndDeposit();
      });
    }

    async function addRentalAndDeposit() {
      if (adding) return;
      const overlapping = selectionInvalid();
      const complete = settings.bookingType === "multiple" ? state.dates.length > 0 : !!state.start;
      if (!complete || overlapping || state.availabilityError) {
        showError(state.availabilityError ? msgAvailError : msgOverlap);
        return;
      }
      const cents = depositCentsForVariant(state.variantId, config);
      const amount = cents / 100;
      const depositVariant = cents > 0 ? findSecurityVariant(cents, config) : null;
      if (cents > 0 && !config.securityProduct) {
        showError(msgDepositProduct);
        return;
      }
      if (cents > 0 && !depositVariant) {
        showError(msgDepositMissing.replace("{{amount}}", formatMoney(amount, config.moneyFormat)));
        return;
      }
      const rentalLink = String(Date.now());
      const productTitle = config.productTitle || "";
      const rentVariant = (config.variants || []).find(
        (item) => normalizeVariantId(item.id) === normalizeVariantId(state.variantId),
      );
      const rentPrice = formatMoney((Number(rentVariant?.price) || 0) / 100, config.moneyFormat);
      const properties = {
        "Rental Start": ymd(state.start),
        "Rental End": state.end ? ymd(state.end) : "",
        Duration: durationText(),
        _rental_link: rentalLink,
      };
      if (settings.bookingType === "multiple" && state.dates.length) {
        properties["Rental Dates"] = state.dates.map((date) => ymd(date)).join(",");
      }
      if (amount > 0) properties["Refundable Security deposit"] = formatMoney(amount, config.moneyFormat);
      const items = [
        {
          id: Number(state.variantId) || state.variantId,
          quantity: 1,
          properties,
        },
      ];
      if (depositVariant) {
        items.push({
          id: Number(depositVariant.id) || depositVariant.id,
          quantity: 1,
          properties: {
            _deposit: "true",
            _rental_link: rentalLink,
            _display_title: `Security deposit for '${productTitle}'`,
            Title: productTitle,
            Price: rentPrice,
            Duration: durationText(),
          },
        });
      }
      adding = true;
      if (submit) submit.disabled = true;
      try {
        const payload = await postCartItems(root, items);
        const openedDrawer = openThemeCart(payload);
        if (!openedDrawer) {
          window.location.href = root.getAttribute("data-cart-url") || "/cart";
          return;
        }
        if (submit) submit.disabled = false;
      } catch (err) {
        showError(err?.message || msgCartError);
        if (submit) submit.disabled = false;
      } finally {
        adding = false;
      }
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

  function normalizeRentalSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const bookingType = "single";
    const calendarStartDays = clampSetting(source.calendarStartDays, 0, 3650, 15);
    let calendarEndDays = clampSetting(source.calendarEndDays, 0, 3650, 365);
    if (calendarEndDays < calendarStartDays) calendarEndDays = calendarStartDays;
    const incoming = source.weekdays && typeof source.weekdays === "object" ? source.weekdays : {};
    const weekdays = {};
    for (const key of SETTINGS_WEEKDAYS) {
      const day = incoming[key] || {};
      weekdays[key] = { start: day.start !== false, end: day.end !== false };
    }
    const blockDates = new Set();
    const list = Array.isArray(source.blockDates) ? source.blockDates : [];
    for (const item of list) {
      const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(item || ""));
      if (match) blockDates.add(match[1]);
    }
    const depositAmount = Number(source.depositAmount);
    return {
      bookingType,
      blockDates,
      calendarStartDays,
      calendarEndDays,
      weekdays,
      depositAmount: Number.isFinite(depositAmount) ? Math.max(0, depositAmount) : 0,
      depositPercent: clampSetting(source.depositPercent, 0, 100, 70),
    };
  }

  function clampSetting(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
  }

  function pickerMode(bookingType) {
    if (bookingType === "range") return "range";
    if (bookingType === "multiple") return "multiple";
    return "single";
  }

  function calendarBounds(settings) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDays = settings.calendarStartDays;
    const min = new Date(today);
    min.setDate(min.getDate() + startDays);
    const max = new Date(today);
    max.setDate(max.getDate() + Math.max(startDays, settings.calendarEndDays));
    return { min, max };
  }

  function loadConfig(root) {
    const el = root.querySelector("[data-rental-config]");
    const fromScript = safeJson(el?.textContent);
    if (fromScript) {
      return {
        optionNames: normalizeOptionNames(fromScript.optionNames),
        variants: fromScript.variants || [],
        securityDeposit: parseMoneyAmount(fromScript.securityDeposit),
        depositPercent: Number(fromScript.depositPercent) || 70,
        rentalSettings: rentalSettingsFromConfig(fromScript.rentalSettings),
        securityProduct: fromScript.securityProduct || null,
        productTitle: fromScript.productTitle || "",
        moneyFormat: fromScript.moneyFormat || "${{amount}}",
      };
    }
    return {
      optionNames: normalizeOptionNames(safeJson(root.getAttribute("data-option-names"))),
      variants: safeJson(root.getAttribute("data-variants")) || [],
      securityDeposit: parseMoneyAmount(root.getAttribute("data-security-deposit")),
      depositPercent: 70,
      rentalSettings: null,
      securityProduct: null,
      productTitle: "",
      moneyFormat: root.getAttribute("data-money-format") || "${{amount}}",
    };
  }

  function rentalSettingsFromConfig(value) {
    if (typeof value === "string") {
      const parsed = safeJson(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    }
    return value && typeof value === "object" ? value : null;
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

  function depositPercent(config) {
    if (config?.rentalSettings && Number.isFinite(Number(config.rentalSettings.depositPercent))) {
      return Math.max(0, Number(config.rentalSettings.depositPercent));
    }
    const rate = Number(config?.depositPercent);
    return Number.isFinite(rate) && rate > 0 ? rate : 70;
  }

  function roundCentsToTen(cents) {
    const amount = Math.round(Number(cents));
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const step = 1000;
    return Math.round(amount / step) * step;
  }

  function depositCentsForVariant(variantId, config) {
    const fixed = Number(config?.rentalSettings?.depositAmount);
    if (config?.rentalSettings && Number.isFinite(fixed) && fixed > 0) {
      return roundCentsToTen(Math.round(fixed * 100));
    }
    if (config?.rentalSettings) {
      const variant = (config?.variants || []).find(
        (item) => normalizeVariantId(item.id) === normalizeVariantId(variantId),
      );
      const priceCents = Number(variant?.price);
      if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;
      return roundCentsToTen(Math.round((priceCents * depositPercent(config)) / 100));
    }
    const fromMetafield = config?.securityDeposit;
    if (fromMetafield != null) {
      if (!(fromMetafield > 0)) return 0;
      return roundCentsToTen(Math.round(fromMetafield * 100));
    }
    const variant = (config?.variants || []).find((item) => normalizeVariantId(item.id) === normalizeVariantId(variantId));
    const priceCents = Number(variant?.price);
    if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;
    return roundCentsToTen(Math.round((priceCents * depositPercent(config)) / 100));
  }

  function depositAmountForVariant(variantId, config) {
    return depositCentsForVariant(variantId, config) / 100;
  }

  function findSecurityVariant(depositCents, config) {
    const variants = config?.securityProduct?.variants || [];
    const target = Math.round(Number(depositCents));
    if (!variants.length || !(target > 0)) return null;
    const priced = variants.filter((variant) => Number(variant.price) === target);
    return priced.find((variant) => variant.available !== false) || priced[0] || null;
  }

  async function postCartItems(root, items) {
    const drawer = document.querySelector("m-cart-drawer");
    const rawUrl = root.getAttribute("data-cart-add-url") || "/cart/add";
    const url = rawUrl.endsWith(".js") ? rawUrl : `${rawUrl}.js`;
    const body = { items };
    if (drawer && typeof drawer.getSectionsToRender === "function") {
      body.sections = [...new Set(drawer.getSectionsToRender().map((section) => section.id))];
      body.sections_url = window.location.pathname;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status) {
      throw new Error(json.description || json.message || "Could not add the rental to the cart. Try again.");
    }
    return json;
  }

  function openThemeCart(payload) {
    const drawer = document.querySelector("m-cart-drawer");
    if (!drawer) return false;
    try {
      if (payload?.sections && typeof drawer.renderContents === "function") {
        drawer.renderContents(payload);
      } else if (typeof drawer.onCartDrawerUpdate === "function") {
        drawer.onCartDrawerUpdate();
        drawer.open();
      } else if (typeof drawer.open === "function") {
        drawer.open();
      } else {
        return false;
      }
    } catch (error) {
      if (typeof drawer.onCartDrawerUpdate === "function") drawer.onCartDrawerUpdate();
      if (typeof drawer.open === "function") drawer.open();
    }
    drawer.classList.remove("m-cart--empty");
    const items = drawer.querySelector("m-cart-drawer-items");
    items?.classList.remove("m-cart--empty");
    if (window.MinimogTheme?.Notification && window.MinimogStrings?.itemAdded && items) {
      window.MinimogTheme.Notification.show({
        target: items,
        method: "prepend",
        type: "success",
        message: window.MinimogStrings.itemAdded,
        delay: 400,
      });
    }
    window.MinimogEvents?.emit?.(window.MinimogTheme?.pubSubEvents?.cartUpdate, payload);
    return true;
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
