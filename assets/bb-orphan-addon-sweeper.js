/**
 * bb-orphan-addon-sweeper.js
 *
 * Removes addon line items whose parent product is no longer in the cart.
 *
 * BACKGROUND
 * ----------
 * bb-product-addons.liquid adds addons (adult signature, engraving, engraved
 * glass, gift card message, product upsells) to the cart as standalone line
 * items, each tagged with a `properties.For` value containing the parent
 * product's title. Nothing in the existing code watches for the parent being
 * removed afterward — when a customer deletes the parent line from the cart
 * drawer or cart page, the addons stay behind, producing carts like:
 *
 *   Adult Signature ($6.99) — For: The Ultimate Beer Lover Gift for Men
 *   Special Card  ($0.00)   — For: The Ultimate Beer Lover Gift for Men
 *
 * …with no Beer Lover. Customer sees an addon-only cart and either bails or
 * pays $6.99 for nothing.
 *
 * FIX
 * ---
 * Generic linkage rule: any line item with a non-empty `properties.For` is an
 * addon. Its parent is whichever line item has a matching `product_title` AND
 * no `properties.For` of its own. If no such parent exists in the current
 * cart, the addon is orphaned and should be removed.
 *
 * Hooks:
 *   - cart:change event (drawer mode) — sweep after every cart mutation.
 *   - DOMContentLoaded (page mode / page load) — safety net for the cart page
 *     (where the theme does window.location.reload() instead of dispatching
 *     cart:change) and for any pre-existing orphan states left by carts that
 *     were polluted before this sweeper shipped.
 *
 * After removal we dispatch cart:refresh rather than cart:change, because the
 * drawer's _onCartChanged path uses a 1250ms setTimeout to swap innerHTML,
 * which clobbers our clean state if it fires after our cleanup. cart:refresh
 * triggers replaceChildren() on a freshly-fetched section — the older
 * setTimeout then writes to a detached DOM node and has no visible effect.
 *
 * KNOWN LIMITATION (not fixed here)
 * ---------------------------------
 * If a parent has quantity > 1 in cart with multiple addons and the customer
 * decrements the parent quantity without going to 0, the addon quantity is
 * not reduced to match. This sweeper only handles full removal. Quantity-
 * pairing is a separate, more involved fix.
 */

(function () {
  'use strict';

  var sweepInProgress = false;
  // Set when a cart:change arrives while a sweep is already running. Drained
  // when the in-flight sweep completes; triggers a fresh /cart.js fetch so we
  // never miss a mutation that could have introduced new orphans.
  var pendingRecheck = false;

  /**
   * Identify orphan line items in a cart.
   * @param {Array} items - Cart items as returned by /cart.js.
   * @returns {Array} subset of items that are orphans.
   */
  function findOrphans(items) {
    if (!items || !items.length) return [];

    // First pass: collect titles of items that ARE parents (no "For" prop).
    // These are real products being purchased, not addons.
    var parentTitles = Object.create(null);
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var props = (item && item.properties) || {};
      var forValue = props['For'];
      if (!forValue) {
        var title = item.product_title || item.title;
        if (title) parentTitles[title] = true;
      }
    }

    // Second pass: items WITH a "For" prop whose parent isn't in the cart.
    var orphans = [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var p = (it && it.properties) || {};
      var fv = p['For'];
      if (fv && !parentTitles[fv]) {
        orphans.push(it);
      }
    }

    return orphans;
  }

  /**
   * POST /cart/update.js to set each orphan's quantity to 0.
   * @param {Array} orphans
   * @returns {Promise<Object|null>} the updated cart, or null on no-op.
   */
  function removeOrphans(orphans) {
    if (!orphans.length) return Promise.resolve(null);

    var updates = Object.create(null);
    for (var i = 0; i < orphans.length; i++) {
      if (orphans[i].key) updates[orphans[i].key] = 0;
    }
    if (!Object.keys(updates).length) return Promise.resolve(null);

    return fetch('/cart/update.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ updates: updates })
    }).then(function (res) {
      if (!res.ok) throw new Error('cart/update.js failed: ' + res.status);
      return res.json();
    });
  }

  /**
   * Sweep handler for cart:change events. Drawer mode.
   */
  function onCartChange(event) {
    if (sweepInProgress) {
      // Don't drop the request — the cart change that fired this could have
      // produced new orphans that we'll never get a second cart:change for.
      // Queue a re-check for after the current sweep completes.
      pendingRecheck = true;
      return;
    }
    var cart = event && event.detail && event.detail.cart;
    if (!cart || !cart.items) return;

    runSweep(cart.items, 'cart:change');
  }

  /**
   * Run a sweep against a known items array. Encapsulates the breadcrumb,
   * the in-progress flag handling, and the cart:refresh dispatch.
   */
  function runSweep(items, source) {
    var orphans = findOrphans(items);
    if (!orphans.length) return;

    // Sentry breadcrumb (if loaded) so we can see this firing in the wild.
    if (window.Sentry && typeof window.Sentry.addBreadcrumb === 'function') {
      try {
        window.Sentry.addBreadcrumb({
          category: 'cart',
          message: 'orphan addons removed',
          level: 'info',
          data: { count: orphans.length, source: source }
        });
      } catch (_) { /* ignore */ }
    }

    // Render-hide orphan line items immediately so the customer doesn't see
    // them flash visible during the 200-1250ms window between drawer re-render
    // and our /cart/update.js completion. Match by line-item key, which the
    // line-item snippet renders as data-line-key on the quantity input.
    hideOrphanLineItems(orphans);

    sweepInProgress = true;
    removeOrphans(orphans)
      .then(function () {
        document.dispatchEvent(new CustomEvent('cart:refresh'));
      })
      .catch(function (err) {
        if (window.console && console.error) {
          console.error('[bb-orphan-addon-sweeper] ' + source + ' sweep failed:', err);
        }
        if (window.Sentry && typeof window.Sentry.captureException === 'function') {
          try { window.Sentry.captureException(err); } catch (_) { /* ignore */ }
        }
      })
      .then(function () {
        sweepInProgress = false;
        // Re-check if a cart:change was skipped while we were busy.
        if (pendingRecheck) {
          pendingRecheck = false;
          // Refetch /cart.js and sweep against the latest server state.
          sweepOnPageLoad();
        }
      });
  }

  /**
   * Best-effort DOM hide for orphan line items, scoped to the cart drawer and
   * cart page. Pure cosmetic — the authoritative state lives in /cart/update.js.
   *
   * Two locators:
   *   1) data-line-key on the quantity input → .closest('line-item'). The most
   *      precise match. Works for engraving, gift card message, product upsells.
   *   2) data-variant-id on <line-item> (only rendered when is_adult_signature
   *      is true; see snippets/line-item.liquid). Adult signature line items
   *      hide their quantity input — there's no data-line-key to match — so
   *      we fall back to variant_id, which is unique enough for the only addon
   *      that renders this way.
   */
  function hideOrphanLineItems(orphans) {
    try {
      for (var i = 0; i < orphans.length; i++) {
        var orph = orphans[i];
        var hidden = false;

        // 1) Match by line-key (quantity input → closest line-item).
        if (orph.key) {
          var inputs = document.querySelectorAll('[data-line-key="' + orph.key + '"]');
          for (var j = 0; j < inputs.length; j++) {
            var row = inputs[j].closest('line-item, .line-item, tr');
            if (row && row.style) {
              row.style.display = 'none';
              row.setAttribute('data-bb-orphan-hidden', '1');
              hidden = true;
            }
          }
        }
        if (hidden) continue;

        // 2) Adult signature fallback — variant_id on <line-item>.
        if (orph.variant_id) {
          var sigRows = document.querySelectorAll(
            'line-item[data-adult-signature="true"][data-variant-id="' + orph.variant_id + '"]'
          );
          for (var k = 0; k < sigRows.length; k++) {
            if (sigRows[k].style) {
              sigRows[k].style.display = 'none';
              sigRows[k].setAttribute('data-bb-orphan-hidden', '1');
            }
          }
        }
      }
    } catch (_) { /* DOM-only optimisation; safe to swallow */ }
  }

  /**
   * One-shot page-load sweep. Covers the cart page (where remove triggers
   * window.location.reload() instead of dispatching cart:change) and any
   * session that was already polluted before this sweeper shipped.
   */
  function sweepOnPageLoad() {
    if (sweepInProgress) {
      pendingRecheck = true;
      return;
    }

    fetch('/cart.js', {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (cart) {
        if (!cart || !cart.items) return null;
        var orphans = findOrphans(cart.items);
        if (!orphans.length) return null;

        if (window.Sentry && typeof window.Sentry.addBreadcrumb === 'function') {
          try {
            window.Sentry.addBreadcrumb({
              category: 'cart',
              message: 'orphan addons removed',
              level: 'info',
              data: { count: orphans.length, source: 'page-load' }
            });
          } catch (_) { /* ignore */ }
        }

        // Hide immediately so the customer never sees them on /cart while we
        // round-trip /cart/update.js + reload.
        hideOrphanLineItems(orphans);

        sweepInProgress = true;
        return removeOrphans(orphans).then(function () {
          // On the cart page: hard reload so the line items list reflects
          // the removal. Anywhere else: cart:refresh is enough.
          var path = (window.location && window.location.pathname) || '';
          if (path === '/cart' || path === '/cart/') {
            window.location.reload();
          } else {
            document.dispatchEvent(new CustomEvent('cart:refresh'));
          }
        });
      })
      .catch(function (err) {
        if (window.console && console.error) {
          console.error('[bb-orphan-addon-sweeper] page-load sweep failed:', err);
        }
        if (window.Sentry && typeof window.Sentry.captureException === 'function') {
          try { window.Sentry.captureException(err); } catch (_) { /* ignore */ }
        }
      })
      .then(function () {
        sweepInProgress = false;
        if (pendingRecheck) {
          pendingRecheck = false;
          // Tail-call back into ourselves — safe because we just cleared
          // sweepInProgress and pendingRecheck.
          sweepOnPageLoad();
        }
      });
  }

  // ---- Wire up ----------------------------------------------------------

  // Drawer mode hook
  document.addEventListener('cart:change', onCartChange);

  // Page-load safety net. On the cart page, where the customer is staring
  // directly at the line items, fire immediately on DOMContentLoaded — the
  // sub-second visible-orphan window the old idle wait permitted was the
  // worst version of this UX. Everywhere else, defer to idle so we don't
  // compete with the initial page render.
  function schedulePageLoadSweep() {
    var path = (window.location && window.location.pathname) || '';
    var onCartPage = path === '/cart' || path === '/cart/';
    if (onCartPage) {
      sweepOnPageLoad();
      return;
    }
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(sweepOnPageLoad, { timeout: 3000 });
    } else {
      setTimeout(sweepOnPageLoad, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedulePageLoadSweep);
  } else {
    schedulePageLoadSweep();
  }
})();
