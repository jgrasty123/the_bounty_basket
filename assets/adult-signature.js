/**
 * Adult Signature Cart Protection
 * 
 * This script prevents the adult signature product from being removed from the cart
 * when alcohol products are present. The adult signature is added to cart from the
 * product page via the centralized product addons handler (bb-product-addons.liquid).
 * 
 * Product ID: 9143475339500
 * Variant ID: 47248470212844
 */

(function() {
  'use strict';

  const ADULT_SIGNATURE_PRODUCT_ID = 9143475339500;
  const ADULT_SIGNATURE_VARIANT_ID = 47248470212844;
  const WARNING_MESSAGE = 'Adult signature is required for all orders';
  const MODAL_DURATION = 4000; // Auto-hide after 4 seconds
  
  // Track if we're currently adding the adult signature to prevent loops
  let isAddingAdultSignature = false;
  let modalTimeout = null;
  let isActive = true; // Track if adult signature protection is still needed
  
  // Store original fetch before overriding (needed by removeAdultSignatureFromCart)
  const originalFetch = window.fetch;
  
  /**
   * Show the warning modal when user tries to remove adult signature
   */
  function showWarningModal() {
    const modal = document.getElementById('adult-signature-modal');
    if (modal) {
      // Clear any existing timeout
      if (modalTimeout) {
        clearTimeout(modalTimeout);
      }
      
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      
      // Auto-hide after duration
      modalTimeout = setTimeout(() => {
        hideWarningModal();
      }, MODAL_DURATION);
    }
  }
  
  /**
   * Hide the warning modal
   */
  function hideWarningModal() {
    const modal = document.getElementById('adult-signature-modal');
    if (modal) {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
    }
    
    if (modalTimeout) {
      clearTimeout(modalTimeout);
      modalTimeout = null;
    }
  }
  
  /**
   * Remove the modal from DOM when no longer needed
   */
  function removeModal() {
    const modal = document.getElementById('adult-signature-modal');
    if (modal) {
      modal.remove();
    }
  }
  
  // Alias for backward compatibility
  const showWarningToast = showWarningModal;
  const hideWarningToast = hideWarningModal;
  
  /**
   * Check if a cart item is the adult signature product
   */
  function isAdultSignatureItem(item) {
    return item && (
      item.product_id === ADULT_SIGNATURE_PRODUCT_ID ||
      item.variant_id === ADULT_SIGNATURE_VARIANT_ID ||
      item.id === ADULT_SIGNATURE_VARIANT_ID ||
      String(item.product_id) === String(ADULT_SIGNATURE_PRODUCT_ID) ||
      String(item.variant_id) === String(ADULT_SIGNATURE_VARIANT_ID) ||
      String(item.id) === String(ADULT_SIGNATURE_VARIANT_ID)
    );
  }
  
  /**
   * Check if the adult signature is in the cart
   */
  async function isAdultSignatureInCart() {
    try {
      const response = await fetch(`${Shopify.routes.root}cart.js`);
      const cart = await response.json();
      return cart.items.some(item => isAdultSignatureItem(item));
    } catch (error) {
      console.error('Error checking cart:', error);
      return false;
    }
  }
  
  /**
   * Check if cart contains products that require alcohol signature
   * This checks for products with "Alcohol Sig" in their option_set metafield
   * Note: We check by product handle since metafields aren't in cart.js
   * Instead we'll check if there are non-adult-signature items in cart
   */
  async function hasAlcoholProductsInCart() {
    try {
      const response = await fetch(`${Shopify.routes.root}cart.js`);
      const cart = await response.json();
      // Check if there are any items besides the adult signature product itself
      const nonAdultSigItems = cart.items.filter(item => !isAdultSignatureItem(item));
      return nonAdultSigItems.length > 0;
    } catch (error) {
      console.error('Error checking cart for alcohol products:', error);
      return true; // Assume true on error to be safe
    }
  }
  
  /**
   * Remove adult signature from cart
   */
  async function removeAdultSignatureFromCart() {
    try {
      const lineKey = await getAdultSignatureLineKey();
      if (!lineKey) return;
      
      // Use the original fetch to bypass our intercept
      await originalFetch.call(window, `${Shopify.routes.root}cart/change.js`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: lineKey,
          quantity: 0
        })
      });
      
      // Dispatch cart change event to update UI
      const cartResponse = await fetch(`${Shopify.routes.root}cart.js`);
      const cartData = await cartResponse.json();
      
      document.documentElement.dispatchEvent(new CustomEvent('cart:change', {
        bubbles: true,
        detail: {
          baseEvent: 'adult-signature:remove',
          cart: cartData
        }
      }));
    } catch (error) {
      console.error('Error removing adult signature from cart:', error);
    }
  }
  
  /**
   * Deactivate adult signature protection and clean up
   */
  function deactivate() {
    isActive = false;
    removeModal();
  }
  
  /**
   * Add the adult signature to the cart
   */
  async function addAdultSignatureToCart() {
    if (isAddingAdultSignature) return;
    
    isAddingAdultSignature = true;
    
    try {
      const response = await fetch(`${Shopify.routes.root}cart/add.js`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          items: [{
            id: ADULT_SIGNATURE_VARIANT_ID,
            quantity: 1
          }]
        })
      });
      
      if (response.ok) {
        // Dispatch cart change event to update UI
        const cartResponse = await fetch(`${Shopify.routes.root}cart.js`);
        const cartData = await cartResponse.json();
        
        document.documentElement.dispatchEvent(new CustomEvent('cart:change', {
          bubbles: true,
          detail: {
            baseEvent: 'adult-signature:add',
            cart: cartData
          }
        }));
        
        // Refresh the page if we're on the cart page
        if (window.themeVariables && window.themeVariables.settings.pageType === 'cart') {
          window.location.reload();
        }
      }
    } catch (error) {
      console.error('Error adding adult signature to cart:', error);
    } finally {
      isAddingAdultSignature = false;
    }
  }
  
  /**
   * Ensure adult signature is in cart on page load
   */
  async function ensureAdultSignatureInCart() {
    const inCart = await isAdultSignatureInCart();
    if (!inCart) {
      await addAdultSignatureToCart();
    }
  }
  
  /**
   * Get the line key for the adult signature item in cart
   */
  async function getAdultSignatureLineKey() {
    try {
      const response = await fetch(`${Shopify.routes.root}cart.js`);
      const cart = await response.json();
      const item = cart.items.find(item => isAdultSignatureItem(item));
      return item ? item.key : null;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Intercept fetch requests to prevent adult signature removal
   */
  window.fetch = async function(...args) {
    const [url, options] = args;
    const urlStr = typeof url === 'string' ? url : url.toString();
    
    // If protection is deactivated, let all requests through
    if (!isActive) {
      return originalFetch.apply(this, args);
    }
    
    // Check if this is a cart change request
    if (urlStr.includes('/cart/change') && options && options.method === 'POST') {
      try {
        let body;
        if (options.body instanceof FormData) {
          body = Object.fromEntries(options.body.entries());
        } else if (typeof options.body === 'string') {
          body = JSON.parse(options.body);
        } else {
          body = options.body;
        }
        
        // Check if trying to remove or set quantity to 0 for adult signature
        const lineKey = body.id || body.line;
        const quantity = parseInt(body.quantity, 10);
        
        if (quantity === 0 || quantity < 1) {
          // Get the current cart to check if this line is the adult signature
          const cartResponse = await originalFetch.call(this, `${Shopify.routes.root}cart.js`);
          const cart = await cartResponse.json();
          
          const targetItem = cart.items.find(item => {
            return item.key === lineKey || 
                   String(item.key) === String(lineKey) ||
                   item.variant_id === parseInt(lineKey, 10);
          });
          
          if (targetItem && isAdultSignatureItem(targetItem)) {
            // Block the removal and show warning
            showWarningModal();
            
            // Return a fake successful response to prevent errors
            return new Response(JSON.stringify(cart), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      } catch (error) {
        // If we can't parse the body, let the request through
        console.error('Error intercepting cart change:', error);
      }
    }
    
    // Check if this is a cart update request (sometimes used for removal)
    if (urlStr.includes('/cart/update') && options && options.method === 'POST') {
      try {
        let body;
        if (options.body instanceof FormData) {
          body = Object.fromEntries(options.body.entries());
        } else if (typeof options.body === 'string') {
          body = JSON.parse(options.body);
        } else {
          body = options.body;
        }
        
        // Check if updates object contains adult signature with quantity 0
        if (body.updates) {
          const adultSignatureKey = await getAdultSignatureLineKey();
          if (adultSignatureKey && body.updates[adultSignatureKey] === 0) {
            showWarningModal();
            const cartResponse = await originalFetch.call(this, `${Shopify.routes.root}cart.js`);
            const cart = await cartResponse.json();
            return new Response(JSON.stringify(cart), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      } catch (error) {
        console.error('Error intercepting cart update:', error);
      }
    }
    
    // Let all other requests through
    return originalFetch.apply(this, args);
  };
  
  /**
   * Intercept URL-based cart changes (for remove links)
   */
  function interceptRemoveLinks() {
    document.addEventListener('click', async function(event) {
      if (!isActive) return;
      
      const link = event.target.closest('a[href*="/cart/change"]');
      if (!link) return;
      
      try {
        const url = new URL(link.href, window.location.origin);
        const lineKey = url.searchParams.get('id');
        const quantity = parseInt(url.searchParams.get('quantity'), 10);
        
        if (quantity === 0) {
          // Check if this is the adult signature
          const cartResponse = await fetch(`${Shopify.routes.root}cart.js`);
          const cart = await cartResponse.json();
          
          const targetItem = cart.items.find(item => item.key === lineKey);
          
          if (targetItem && isAdultSignatureItem(targetItem)) {
            event.preventDefault();
            event.stopPropagation();
            showWarningModal();
            return false;
          }
        }
      } catch (error) {
        console.error('Error intercepting remove link:', error);
      }
    }, true);
  }
  
  /**
   * Initialize modal close handlers
   */
  function initModalHandlers() {
    document.addEventListener('click', function(event) {
      // Close button click
      if (event.target.closest('[data-adult-signature-close]')) {
        hideWarningModal();
        return;
      }
      
      // Backdrop click
      if (event.target.classList.contains('adult-signature-modal__backdrop')) {
        hideWarningModal();
        return;
      }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        hideWarningModal();
      }
    });
  }
  
  /**
   * Listen for cart changes and manage adult signature requirement
   */
  function listenForCartChanges() {
    document.addEventListener('cart:change', async function(event) {
      if (!isActive) return;
      
      // Don't trigger if we just added or removed the adult signature
      if (event.detail && (event.detail.baseEvent === 'adult-signature:add' || event.detail.baseEvent === 'adult-signature:remove')) {
        return;
      }
      
      // Small delay to let the cart update complete
      setTimeout(async () => {
        const hasAlcohol = await hasAlcoholProductsInCart();
        
        if (!hasAlcohol) {
          // No more alcohol products - remove adult signature and clean up
          await removeAdultSignatureFromCart();
          deactivate();
          return;
        }
        
        // Still have alcohol products - ensure adult signature is in cart
        const inCart = await isAdultSignatureInCart();
        if (!inCart) {
          await addAdultSignatureToCart();
        }
      }, 100);
    });
  }
  
  /**
   * Initialize everything when DOM is ready
   */
  function init() {
    // Note: Adult signature is now added from the product page via bb-product-addons.liquid
    // This script only handles cart protection (preventing removal)
    
    // Set up event listeners
    interceptRemoveLinks();
    initModalHandlers();
    listenForCartChanges();
  }
  
  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Also run when page is shown (handles back/forward cache)
  window.addEventListener('pageshow', function(event) {
    if (event.persisted) {
      // Re-initialize listeners on page restore from cache
      init();
    }
  });
  
  // Export for external use if needed
  window.AdultSignature = {
    VARIANT_ID: ADULT_SIGNATURE_VARIANT_ID,
    showWarning: showWarningModal,
    hideWarning: hideWarningModal,
    ensureInCart: ensureAdultSignatureInCart,
    removeFromCart: removeAdultSignatureFromCart,
    isAdultSignatureItem: isAdultSignatureItem,
    deactivate: deactivate,
    isActive: () => isActive
  };
})();
