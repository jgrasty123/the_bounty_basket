/**
 * bb-delivery-date-picker.js
 *
 * Custom delivery date picker for Bounty Basket Co. cart.
 * Replaces ODD/identixweb.
 *
 * Architecture notes:
 *  - Pure vanilla JS, no dependencies.
 *  - Does NOT wrap window.fetch (lessons from Edge ATC outage).
 *  - Calls /cart/update.js directly, no event dispatching.
 *  - All date math in calendar-date tuples (Y/M/D), only touches timezone
 *    for the 2pm PT cutoff comparison.
 *  - State persisted in sessionStorage so /cart refresh keeps selection.
 *
 * Cart attributes written (must match ShipWorks/fulfillment exactly):
 *    "Order Type"    : "Shipping"
 *    "Delivery Date" : "MM-DD-YYYY"
 *    "Delivery Day"  : "Wednesday"
 *    "Date Format"   : "mm-dd-yy"
 */

(function () {
  'use strict';

  var DAY_NAMES_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var DAY_NAMES_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var DAY_NAMES_ABBR  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var MONTH_NAMES     = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  var STORAGE_KEY = 'bb-delivery-date-v1';

  // ---------- Date helpers (calendar-date tuples) ------------------------

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function toCalendarDate(d) {
    // d: {y, m, d}  (m is 0-11)
    return { y: d.y, m: d.m, d: d.d };
  }

  function calendarDateFromYMD(y, m, d) {
    return { y: y, m: m, d: d };
  }

  function calendarDateFromDate(jsDate) {
    return { y: jsDate.getFullYear(), m: jsDate.getMonth(), d: jsDate.getDate() };
  }

  function calendarDateAddDays(cd, days) {
    var jsDate = new Date(cd.y, cd.m, cd.d);
    jsDate.setDate(jsDate.getDate() + days);
    return calendarDateFromDate(jsDate);
  }

  function calendarDateEquals(a, b) {
    return a.y === b.y && a.m === b.m && a.d === b.d;
  }

  function calendarDateCompare(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    if (a.m !== b.m) return a.m - b.m;
    return a.d - b.d;
  }

  function calendarDateDayOfWeek(cd) {
    // 0 = Sunday
    return new Date(cd.y, cd.m, cd.d).getDay();
  }

  function calendarDateToMMDDYYYY(cd) {
    return pad2(cd.m + 1) + '-' + pad2(cd.d) + '-' + cd.y;
  }

  function calendarDateToISO(cd) {
    return cd.y + '-' + pad2(cd.m + 1) + '-' + pad2(cd.d);
  }

  function calendarDateFromISO(iso) {
    var parts = (iso || '').split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return { y: y, m: m, d: d };
  }

  function calendarDateFromMMDDYYYY(s) {
    // Accepts "MM-DD-YYYY" or "M-D-YYYY"
    var parts = (s || '').split('-');
    if (parts.length !== 3) return null;
    var m = parseInt(parts[0], 10) - 1;
    var d = parseInt(parts[1], 10);
    var y = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return { y: y, m: m, d: d };
  }

  // ---------- Timezone-aware "now" --------------------------------------

  function nowInTimezone(timezone) {
    // Returns { y, m, d, hours, minutes } as wall-clock time in given timezone.
    var now = new Date();
    try {
      var fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      var parts = fmt.formatToParts(now);
      var lookup = {};
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type !== 'literal') lookup[parts[i].type] = parts[i].value;
      }
      return {
        y: parseInt(lookup.year, 10),
        m: parseInt(lookup.month, 10) - 1,
        d: parseInt(lookup.day, 10),
        hours: parseInt(lookup.hour, 10),
        minutes: parseInt(lookup.minute, 10)
      };
    } catch (e) {
      // Fallback: use local browser time.
      return {
        y: now.getFullYear(),
        m: now.getMonth(),
        d: now.getDate(),
        hours: now.getHours(),
        minutes: now.getMinutes()
      };
    }
  }

  // ---------- Settings parsing ------------------------------------------

  function parseHolidays(holidaysStr) {
    var set = {};
    if (!holidaysStr) return set;
    var entries = holidaysStr.split(',');
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i].trim();
      if (!entry) continue;
      // Accept MM/DD/YYYY or MM-DD-YYYY
      var normalized = entry.replace(/\//g, '-');
      var parts = normalized.split('-');
      if (parts.length !== 3) continue;
      var m = parseInt(parts[0], 10) - 1;
      var d = parseInt(parts[1], 10);
      var y = parseInt(parts[2], 10);
      if (isNaN(y) || isNaN(m) || isNaN(d)) continue;
      set[y + '-' + pad2(m + 1) + '-' + pad2(d)] = true;
    }
    return set;
  }

  function parseWorkingDays(workingDaysStr) {
    // Returns array of booleans, index 0=Sunday..6=Saturday
    var arr = [false, false, false, false, false, false, false];
    if (!workingDaysStr) {
      // Sensible default: Mon-Fri
      arr[1] = arr[2] = arr[3] = arr[4] = arr[5] = true;
      return arr;
    }
    var entries = workingDaysStr.split(',');
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i].trim().toLowerCase().slice(0, 3);
      var idx = ['sun','mon','tue','wed','thu','fri','sat'].indexOf(name);
      if (idx >= 0) arr[idx] = true;
    }
    return arr;
  }

  function parseCutoffTime(cutoffStr) {
    // "14:00" -> { hours: 14, minutes: 0 }
    var parts = (cutoffStr || '14:00').split(':');
    return {
      hours: parseInt(parts[0], 10) || 14,
      minutes: parseInt(parts[1], 10) || 0
    };
  }

  // ---------- Earliest valid date computation ---------------------------

  // SHIPPING days = days the warehouse processes & hands packages to carriers.
  // Mon-Fri minus holidays (settings.workingDays drives this).
  function isShippingDay(cd, settings) {
    if (!settings.workingDays[calendarDateDayOfWeek(cd)]) return false;
    if (settings.holidays[calendarDateToISO(cd)]) return false;
    return true;
  }

  // DELIVERY days = days the carrier delivers to recipient.
  // Mon-Sat are valid. Sun is NEVER valid (UPS/GLS don't deliver Sun).
  // Holidays always block.
  function isDeliveryDay(cd, settings) {
    if (calendarDateDayOfWeek(cd) === 0) return false; // Sun never
    if (settings.holidays[calendarDateToISO(cd)]) return false;
    return true; // Sat OK, Mon-Fri OK
  }

  // Backward-compat: render code uses isWorkingDay() to decide if a calendar
  // cell is pickable. From the customer's POV, "pickable" means "valid
  // delivery day".
  function isWorkingDay(cd, workingDays, holidays) {
    return isDeliveryDay(cd, { workingDays: workingDays, holidays: holidays });
  }

  function computeShipDate(settings) {
    // Returns the calendar date the order will actually ship.
    // - If today is a shipping day AND we haven't passed cutoff -> today
    // - Otherwise -> next shipping day (skipping weekends + holidays)
    var now = nowInTimezone(settings.cutoffTimezone);
    var todayCD = calendarDateFromYMD(now.y, now.m, now.d);
    var cutoff = settings.cutoffTime;
    var pastCutoff = (now.hours > cutoff.hours) ||
                     (now.hours === cutoff.hours && now.minutes >= cutoff.minutes);

    if (isShippingDay(todayCD, settings) && !pastCutoff) return todayCD;

    var cd = calendarDateAddDays(todayCD, 1);
    var safety = 30;
    while (!isShippingDay(cd, settings) && safety-- > 0) {
      cd = calendarDateAddDays(cd, 1);
    }
    return cd;
  }

  function computeEarliestValidDate(settings) {
    // Earliest delivery = ship date + 1 calendar day, advancing past
    // Sundays/holidays.
    //
    // Examples (cutoff 2pm PT, ship Mon-Fri, deliver Mon-Sat, no holidays):
    //   Thu 11am -> ship Thu -> delivery Fri
    //   Thu 3pm  -> ship Fri -> delivery Sat (Sat OK!)
    //   Fri 11am -> ship Fri -> delivery Sat
    //   Fri 3pm  -> ship Mon -> delivery Tue
    //   Sat any  -> ship Mon -> delivery Tue
    //   Sun any  -> ship Mon -> delivery Tue
    //
    var shipCD = computeShipDate(settings);
    var deliveryCD = calendarDateAddDays(shipCD, 1);
    var safety = 30;
    while (!isDeliveryDay(deliveryCD, settings) && safety-- > 0) {
      deliveryCD = calendarDateAddDays(deliveryCD, 1);
    }
    return deliveryCD;
  }

  function isPastCutoffNow(settings) {
    var now = nowInTimezone(settings.cutoffTimezone);
    var cutoff = settings.cutoffTime;
    return (now.hours > cutoff.hours) ||
           (now.hours === cutoff.hours && now.minutes >= cutoff.minutes);
  }

  function computeMaxDate(todayCD, maxDaysOut) {
    return calendarDateAddDays(todayCD, maxDaysOut);
  }

  // ---------- Cart write ------------------------------------------------

  function writeCartAttributes(deliveryDateCD, statusEl) {
    var payload;
    var dayName = '';
    var deliveryDateStr = '';
    if (deliveryDateCD) {
      dayName = DAY_NAMES_FULL[calendarDateDayOfWeek(deliveryDateCD)];
      deliveryDateStr = calendarDateToMMDDYYYY(deliveryDateCD);
      payload = {
        attributes: {
          'Order Type'   : 'Shipping',
          'Delivery Date': deliveryDateStr,
          'Delivery Day' : dayName,
          'Date Format'  : 'mm-dd-yy'
        }
      };
    } else {
      // Clearing — pass empty strings so Shopify removes the attributes from the cart
      payload = {
        attributes: {
          'Order Type'   : '',
          'Delivery Date': '',
          'Delivery Day' : '',
          'Date Format'  : ''
        }
      };
    }

    if (statusEl) statusEl.textContent = deliveryDateCD ? 'Saving\u2026' : 'Clearing\u2026';

    return fetch('/cart/update.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Cart update failed: ' + res.status);
      return res.json();
    })
    .then(function () {
      if (statusEl) {
        statusEl.textContent = deliveryDateCD ? 'Delivery date saved.' : 'Delivery date cleared.';
        setTimeout(function () {
          var savedMsg = deliveryDateCD ? 'Delivery date saved.' : 'Delivery date cleared.';
          if (statusEl.textContent === savedMsg) statusEl.textContent = '';
        }, 2500);
      }
      if (deliveryDateCD) {
        try {
          sessionStorage.setItem(STORAGE_KEY, calendarDateToISO(deliveryDateCD));
        } catch (e) { /* storage may be disabled in private mode */ }
      } else {
        try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      }

      // Sentry breadcrumb (if present) — passive observation only.
      if (window.Sentry && typeof window.Sentry.addBreadcrumb === 'function') {
        try {
          window.Sentry.addBreadcrumb({
            category: 'cart',
            message: deliveryDateCD ? 'delivery date saved' : 'delivery date cleared',
            level: 'info',
            data: deliveryDateCD ? { date: deliveryDateStr, day: dayName } : {}
          });
        } catch (e) { /* ignore */ }
      }
    })
    .catch(function (err) {
      if (statusEl) statusEl.textContent = 'Could not save date. Please try again.';
      if (window.Sentry && typeof window.Sentry.captureException === 'function') {
        try { window.Sentry.captureException(err); } catch (e) { /* ignore */ }
      }
    });
  }

  // ---------- Rendering -------------------------------------------------

  function buildMonthGrid(viewMonth, selectedCD, earliestCD, maxCD, todayCD, settings) {
    // viewMonth: { y, m }
    // Returns DocumentFragment for one month grid.
    var frag = document.createDocumentFragment();

    // Header row
    var header = document.createElement('div');
    header.className = 'bb-cal__header';

    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'bb-cal__nav bb-cal__nav--prev';
    prevBtn.setAttribute('aria-label', 'Previous month');
    prevBtn.innerHTML = '&larr;';

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'bb-cal__nav bb-cal__nav--next';
    nextBtn.setAttribute('aria-label', 'Next month');
    nextBtn.innerHTML = '&rarr;';

    var monthLabel = document.createElement('span');
    monthLabel.className = 'bb-cal__month-label';
    monthLabel.textContent = MONTH_NAMES[viewMonth.m] + ' ' + viewMonth.y;

    // Disable prev if showing earliest visible month
    var firstOfView = calendarDateFromYMD(viewMonth.y, viewMonth.m, 1);
    var firstOfTodayMonth = calendarDateFromYMD(todayCD.y, todayCD.m, 1);
    if (calendarDateCompare(firstOfView, firstOfTodayMonth) <= 0) {
      prevBtn.disabled = true;
      prevBtn.classList.add('is-disabled');
    }
    // Disable next if next month is past max
    var firstOfNextView = calendarDateFromYMD(
      viewMonth.m === 11 ? viewMonth.y + 1 : viewMonth.y,
      viewMonth.m === 11 ? 0 : viewMonth.m + 1,
      1
    );
    if (calendarDateCompare(firstOfNextView, maxCD) > 0) {
      nextBtn.disabled = true;
      nextBtn.classList.add('is-disabled');
    }

    header.appendChild(prevBtn);
    header.appendChild(monthLabel);
    header.appendChild(nextBtn);
    frag.appendChild(header);

    // Day-of-week labels
    var dowRow = document.createElement('div');
    dowRow.className = 'bb-cal__dow-row';
    for (var d = 0; d < 7; d++) {
      var dow = document.createElement('span');
      dow.className = 'bb-cal__dow';
      dow.textContent = DAY_NAMES_ABBR[d];
      dowRow.appendChild(dow);
    }
    frag.appendChild(dowRow);

    // Day cells
    var grid = document.createElement('div');
    grid.className = 'bb-cal__grid';
    grid.setAttribute('role', 'grid');

    var firstDayOfMonth = calendarDateFromYMD(viewMonth.y, viewMonth.m, 1);
    var firstDow = calendarDateDayOfWeek(firstDayOfMonth);
    var daysInMonth = new Date(viewMonth.y, viewMonth.m + 1, 0).getDate();

    // Leading blanks
    for (var i = 0; i < firstDow; i++) {
      var blank = document.createElement('span');
      blank.className = 'bb-cal__cell bb-cal__cell--blank';
      grid.appendChild(blank);
    }

    // Day cells
    for (var day = 1; day <= daysInMonth; day++) {
      var cellCD = calendarDateFromYMD(viewMonth.y, viewMonth.m, day);
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'bb-cal__cell';
      cell.textContent = day;
      cell.setAttribute('data-date', calendarDateToISO(cellCD));
      cell.setAttribute('role', 'gridcell');

      var isPast        = calendarDateCompare(cellCD, earliestCD) < 0;
      var isAfterMax    = calendarDateCompare(cellCD, maxCD) > 0;
      var isToday       = calendarDateEquals(cellCD, todayCD);
      var isSelected    = selectedCD && calendarDateEquals(cellCD, selectedCD);
      var isHoliday     = settings.holidays[calendarDateToISO(cellCD)];
      var isSunday      = calendarDateDayOfWeek(cellCD) === 0;
      var isUnavailable = isPast || isAfterMax || isHoliday || isSunday;

      if (isToday)        cell.classList.add('is-today');
      if (isSelected)     cell.classList.add('is-selected');
      if (isUnavailable) {
        cell.classList.add('is-disabled');
        cell.disabled = true;
        if (isHoliday)  cell.setAttribute('title', 'Holiday — closed');
        if (isSunday)   cell.setAttribute('title', 'No Sunday delivery');
        if (isPast)     cell.setAttribute('title', 'Earliest available date is later');
        if (isAfterMax) cell.setAttribute('title', 'Too far out');
      } else {
        cell.classList.add('is-available');
      }

      grid.appendChild(cell);
    }

    frag.appendChild(grid);
    return { fragment: frag, prevBtn: prevBtn, nextBtn: nextBtn, grid: grid };
  }

  // ---------- Main controller -------------------------------------------

  function initPicker(rootEl) {
    // Guard against double-init. We use TWO flags so a thrown-mid-init attempt
    // doesn't permanently poison the element:
    //   data-bb-init-attempt : set immediately when init is in flight. Cleared
    //                          in the catch block so a follow-up call retries.
    //   data-bb-inited       : set ONLY after render() succeeds. A node carrying
    //                          this flag is fully wired; we skip re-init.
    // The prior implementation set bbInited=1 before render(); if anything between
    // (settings parsing, computeEarliestValidDate, render itself) threw, the picker
    // stayed visually stuck on "Loading available dates…" with no retry possible.
    if (rootEl.dataset.bbInited === '1') return;
    if (rootEl.dataset.bbInitAttempt === '1') return;
    rootEl.dataset.bbInitAttempt = '1';

    try {
      _initPickerInner(rootEl);
      rootEl.dataset.bbInited = '1';
    } catch (err) {
      // Init failed. Clear the attempt flag so the heartbeat (or the next
      // MutationObserver fire) can retry. Surface the error to Sentry but never
      // let the customer see indefinite "Loading…" — fall through to a friendly
      // skip message so checkout still works.
      delete rootEl.dataset.bbInitAttempt;
      try {
        var calendarEl = rootEl.querySelector('[data-bb-calendar]');
        if (calendarEl && calendarEl.querySelector('.bb-delivery-date-picker__loading')) {
          calendarEl.innerHTML =
            '<p class="bb-delivery-date-picker__helper">' +
            'Pick a date at checkout or skip — your order will ship next business day.' +
            '</p>';
        }
      } catch (_) { /* DOM might be gone; nothing to do */ }
      if (window.Sentry && typeof window.Sentry.captureException === 'function') {
        try { window.Sentry.captureException(err); } catch (_) { /* ignore */ }
      }
    }
  }

  function _initPickerInner(rootEl) {
    var DEFAULT_COPY_BEFORE = 'Order before 2pm PT and we ship today. Estimated arrival: {arrival_date}. Pick a date or skip, checkout works either way.';
    var DEFAULT_COPY_AFTER  = 'Cutoff is 2pm PT Mon-Fri. Ships {ship_day}, estimated arrival {arrival_date}. Pick a date or skip, checkout works either way.';
    var DEFAULT_COPY_PICKED = 'Your order is set to arrive {arrival_long}.';

    var settings = {
      cutoffTime      : parseCutoffTime(rootEl.getAttribute('data-cutoff-time')),
      cutoffTimezone  : rootEl.getAttribute('data-cutoff-timezone') || 'America/Los_Angeles',
      workingDays     : parseWorkingDays(rootEl.getAttribute('data-working-days')),
      minLeadDays     : parseInt(rootEl.getAttribute('data-min-lead-days'), 10) || 1,
      maxDaysOut      : parseInt(rootEl.getAttribute('data-max-days-out'), 10) || 180,
      holidays        : parseHolidays(rootEl.getAttribute('data-holidays')),
      copyTemplates   : {
        beforeCutoff  : rootEl.getAttribute('data-copy-before-cutoff') || DEFAULT_COPY_BEFORE,
        afterCutoff   : rootEl.getAttribute('data-copy-after-cutoff')  || DEFAULT_COPY_AFTER,
        selected      : rootEl.getAttribute('data-copy-selected')      || DEFAULT_COPY_PICKED
      }
    };

    var calendarEl = rootEl.querySelector('[data-bb-calendar]');
    var statusEl   = rootEl.querySelector('[data-bb-status]');
    var helperEl   = rootEl.querySelector('[data-bb-helper]');
    if (!calendarEl) return;

    var nowTZ = nowInTimezone(settings.cutoffTimezone);
    var todayCD = calendarDateFromYMD(nowTZ.y, nowTZ.m, nowTZ.d);
    var earliestCD = computeEarliestValidDate(settings);
    var maxCD = computeMaxDate(todayCD, settings.maxDaysOut);

    // Determine initial selected date.
    // RULE: never auto-select. If sessionStorage has a previously-picked date
    // that is still valid, restore it. Otherwise leave selectedCD = null and
    // let the customer pick (or skip — checkout works either way).
    var selectedCD = null;
    var savedISO = null;
    try { savedISO = sessionStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    if (savedISO) {
      var savedCD = calendarDateFromISO(savedISO);
      if (savedCD && calendarDateCompare(savedCD, earliestCD) >= 0 &&
          calendarDateCompare(savedCD, maxCD) <= 0 &&
          isDeliveryDay(savedCD, settings)) {
        selectedCD = savedCD;
      }
    }
    if (!selectedCD) {
      // Also accept a date already in cart attributes (e.g. customer came
      // back from checkout and reloaded /cart).
      var existingDateStr = rootEl.getAttribute('data-current-delivery-date');
      var existingCD = calendarDateFromMMDDYYYY(existingDateStr);
      if (existingCD && calendarDateCompare(existingCD, earliestCD) >= 0 &&
          calendarDateCompare(existingCD, maxCD) <= 0 &&
          isDeliveryDay(existingCD, settings)) {
        selectedCD = existingCD;
      }
    }
    // No fallback to earliestCD — customer must click to select.

    // Default the calendar view to the month containing earliest valid date,
    // or the selected month if one is restored.
    var viewMonth = selectedCD
      ? { y: selectedCD.y, m: selectedCD.m }
      : { y: earliestCD.y, m: earliestCD.m };

    function fillTemplate(tmpl, values) {
      // Replace {placeholder} with auto-bolded value. Unknown placeholders
      // are left as-is so the admin notices the typo.
      if (!tmpl) return '';
      return tmpl.replace(/\{(\w+)\}/g, function (match, key) {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
          return '<strong>' + values[key] + '</strong>';
        }
        return match;
      });
    }

    function updateHelperCopy() {
      if (!helperEl) return;

      if (selectedCD) {
        var arrivalLong = DAY_NAMES_FULL[calendarDateDayOfWeek(selectedCD)] + ', ' +
          MONTH_NAMES[selectedCD.m] + ' ' + selectedCD.d + ', ' + selectedCD.y;
        helperEl.innerHTML = fillTemplate(settings.copyTemplates.selected, {
          arrival_long: arrivalLong
        });
        return;
      }

      // No selection: ship cutoff + estimated arrival.
      var shipCD = computeShipDate(settings);
      var shipDay = DAY_NAMES_FULL[calendarDateDayOfWeek(shipCD)];
      var arrivalShort = DAY_NAMES_SHORT[calendarDateDayOfWeek(earliestCD)] + ', ' +
        MONTH_NAMES[earliestCD.m].slice(0, 3) + ' ' + earliestCD.d;
      var arrivalLongUnselected = DAY_NAMES_FULL[calendarDateDayOfWeek(earliestCD)] + ', ' +
        MONTH_NAMES[earliestCD.m] + ' ' + earliestCD.d + ', ' + earliestCD.y;

      var tmpl = isPastCutoffNow(settings)
        ? settings.copyTemplates.afterCutoff
        : settings.copyTemplates.beforeCutoff;

      helperEl.innerHTML = fillTemplate(tmpl, {
        ship_day: shipDay,
        arrival_date: arrivalShort,
        arrival_long: arrivalLongUnselected
      });
    }

    function clearSelection() {
      selectedCD = null;
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ok */ }
      writeCartAttributes(null, statusEl);
      render();
      updateHelperCopy();
    }

    function render() {
      calendarEl.innerHTML = '';
      var built = buildMonthGrid(viewMonth, selectedCD, earliestCD, maxCD, todayCD, settings);
      calendarEl.appendChild(built.fragment);

      built.prevBtn.addEventListener('click', function () {
        if (built.prevBtn.disabled) return;
        if (viewMonth.m === 0) { viewMonth.m = 11; viewMonth.y--; }
        else viewMonth.m--;
        render();
      });
      built.nextBtn.addEventListener('click', function () {
        if (built.nextBtn.disabled) return;
        if (viewMonth.m === 11) { viewMonth.m = 0; viewMonth.y++; }
        else viewMonth.m++;
        render();
      });
      built.grid.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('button.bb-cal__cell');
        if (!btn || btn.disabled) return;
        var iso = btn.getAttribute('data-date');
        var cd = calendarDateFromISO(iso);
        if (!cd) return;
        if (calendarDateCompare(cd, earliestCD) < 0) return;
        if (calendarDateCompare(cd, maxCD) > 0) return;
        if (!isDeliveryDay(cd, settings)) return;
        selectedCD = cd;
        viewMonth = { y: cd.y, m: cd.m };
        render();
        updateHelperCopy();
        writeCartAttributes(cd, statusEl);
      });

      // Wire clear button (rendered in footer below)
      var clearBtn = rootEl.querySelector('[data-bb-clear]');
      if (clearBtn) {
        clearBtn.style.display = selectedCD ? '' : 'none';
        clearBtn.onclick = clearSelection;
      }
    }

    render();
    updateHelperCopy();
    // Refresh the countdown copy every minute so it stays accurate near cutoff.
    // Track the interval ID on the root so we can clear it if the root is
    // removed from the DOM (cart drawer re-render destroys the old picker).
    var helperIntervalId = setInterval(updateHelperCopy, 60000);
    rootEl._bbCleanup = function () {
      clearInterval(helperIntervalId);
    };
  }

  function initAll() {
    var roots = document.querySelectorAll('[data-bb-date-picker]');
    for (var i = 0; i < roots.length; i++) initPicker(roots[i]);
  }

  // Cleanup hook for picker roots removed from the DOM (e.g. cart drawer
  // re-render). Prevents setInterval closures from leaking.
  function cleanupRoot(node) {
    if (!node || node.nodeType !== 1) return;
    if (typeof node._bbCleanup === 'function') {
      try { node._bbCleanup(); } catch (e) { /* ignore */ }
      node._bbCleanup = null;
    }
  }

  function bootstrap() {
    initAll();

    // Re-init when sections re-render in the theme editor.
    document.addEventListener('shopify:section:load', initAll);

    // ------------------------------------------------------------------
    // CART DRAWER RE-RENDER HANDLING (the actual fix for the loading bug)
    // ------------------------------------------------------------------
    // When a 2nd item is added to cart, cart-drawer.js (in assets/theme.js)
    // does `currentInner.innerHTML = updatedInner.innerHTML` to swap in the
    // freshly-rendered drawer HTML. That wipes the previously-inited picker
    // element (with its data-bb-inited="1" flag) and inserts a fresh one in
    // its default Liquid markup state — i.e. stuck on "Loading available
    // dates…". No event is fired that the existing init listeners catch.
    //
    // A MutationObserver on the document body picks up the newly-inserted
    // picker root regardless of how it got there (innerHTML swap, fetch +
    // replaceChildren, future drawer refactors, etc.) and inits it.
    // initPicker() is idempotent via the dataset.bbInited guard, so calling
    // it on the same element twice is safe.
    if ('MutationObserver' in window) {
      var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var mut = mutations[i];

          // Newly-added nodes: scan for picker roots and init them.
          var added = mut.addedNodes;
          if (added && added.length) {
            for (var j = 0; j < added.length; j++) {
              var addedNode = added[j];
              if (addedNode.nodeType !== 1) continue; // skip text/comment
              if (addedNode.matches && addedNode.matches('[data-bb-date-picker]')) {
                initPicker(addedNode);
              }
              if (addedNode.querySelectorAll) {
                var nestedAdded = addedNode.querySelectorAll('[data-bb-date-picker]');
                for (var k = 0; k < nestedAdded.length; k++) initPicker(nestedAdded[k]);
              }
            }
          }

          // Removed nodes: clean up intervals on detached picker roots.
          var removed = mut.removedNodes;
          if (removed && removed.length) {
            for (var r = 0; r < removed.length; r++) {
              var removedNode = removed[r];
              if (removedNode.nodeType !== 1) continue;
              cleanupRoot(removedNode);
              if (removedNode.querySelectorAll) {
                var nestedRemoved = removedNode.querySelectorAll('[data-bb-date-picker]');
                for (var rk = 0; rk < nestedRemoved.length; rk++) cleanupRoot(nestedRemoved[rk]);
              }
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // ------------------------------------------------------------------
    // STUCK-LOADING HEARTBEAT (belt-and-suspenders for the May 19 bug)
    // ------------------------------------------------------------------
    // The MutationObserver above SHOULD catch every cart-drawer re-render
    // that inserts a fresh picker. In production, James captured a state
    // where the drawer was showing "Loading available dates…" indefinitely
    // on a cart containing only orphan signature fees. Diagnosis was
    // ambiguous (race vs. thrown init vs. observer miss), so the heartbeat
    // is intentionally redundant — it scans every 2 seconds for the first
    // 30 seconds of any picker's lifecycle, looking for elements still
    // showing the loading placeholder. Any it finds, it re-runs initPicker
    // on (idempotent via the bbInited/bbInitAttempt flags above).
    //
    // Cheap: querySelectorAll on a rare selector, scoped to .bb-cal__grid
    // and .bb-delivery-date-picker__loading. Stops after 15 cycles.
    var heartbeatCycles = 0;
    var heartbeatId = setInterval(function () {
      heartbeatCycles++;
      if (heartbeatCycles >= 15) {
        clearInterval(heartbeatId);
        return;
      }
      var stuck = document.querySelectorAll(
        '[data-bb-date-picker] .bb-delivery-date-picker__loading'
      );
      if (!stuck.length) return;
      for (var s = 0; s < stuck.length; s++) {
        var root = stuck[s].closest('[data-bb-date-picker]');
        if (!root) continue;
        // The element is still showing "Loading…" — either init never ran
        // on it, or init threw. Clear both flags and re-attempt.
        delete root.dataset.bbInited;
        delete root.dataset.bbInitAttempt;
        initPicker(root);
      }
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
