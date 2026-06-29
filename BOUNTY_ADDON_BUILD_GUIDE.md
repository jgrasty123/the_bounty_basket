# Bounty Basket — Product Add-On Build Guide

Companion to `bounty_addon_products_import.csv`. Do these steps in order.

## Step 1 — Import the add-on products (Matrixify)
Run `bounty_addon_products_import.csv` through Matrixify (Products entity).
Creates 28 hidden add-on products (snack, cocktail, spa, bow, 2 fees), all:
- Vendor: The Bounty Basket Co.
- Tags: social-exclude, addon, hidden
- Inventory: untracked (never blocks a cart)
- Published: TRUE (must be on Online Store channel to be referenced)

**After import:** upload real photos for the 4 SPA items (BNTY-SPA-01..04) and the
2 fee products — their Image Src in the CSV is a placeholder and will not resolve.
Snack/cocktail/bow images reuse working BroBasket CDN URLs.

## Step 2 — Confirm the Upsell metaobject definition exists
Settings > Custom data > Metaobjects. You should already have an **Upsell** definition
(fields: name, description_optional, products [list.variant_reference], type, modal_*).
If not, create it per the existing BroBasket schema (the theme reads
`product.metafields.custom.upsell` = list.metaobject_reference -> Upsell).

## Step 3 — Create 4 Upsell metaobject entries
For each group below, create one Upsell entry. `type` = Checkbox (multi-select).
Add each listed product's DEFAULT variant to the `products` field.

### Group: Snack add-on   (name: "Snack add-on")
Popcornopolis Kettle Corn, Popcornopolis Caramel Corn, Ghirardelli Caramel,
Ghirardelli Raspberry, Ghirardelli Sea Salt Almond, Marich Blueberries,
Marich Toffee Caramels, Marich Sea Salt Almonds, Koppers Espresso Beans,
Ferrero Rocher 3pc, Oreos, M&Ms

### Group: Cocktail add-on   (name: "Cocktail add-on")
Fever Tree Tonic, Fever Tree Ginger Beer, Fever Tree Club Soda,
Tres Agaves Margarita Mix, Zing Zang Bloody Mary, Filthy Cocktail Olives,
Filthy Red Cherries, A Bar Above Bell Jigger, A Bar Above Bar Spoon

### Group: Spa add-on   (name: "Spa add-on")
Nectar + Honey Body Scrub, Nectar + Honey Body Butter,
Sea + Tea Clay Face Mask, Soy Wax Candle — Lavender Fields

### Group: Popular add-ons   (name: "Popular add-ons")
Red Satin Bow, Shipping Insurance

(Adult Signature Fee is handled by the existing adult_signature block, NOT an upsell group.)

## Step 4 — Assign upsell groups to the 14 products
On each product, set metafield `custom.upsell` to reference the listed groups.
(This is a metaobject reference, not text — pick the Upsell entries in the metafield UI.)

| Product handle                  | Snack | Cocktail | Spa | Popular |
|---------------------------------|:-----:|:--------:|:---:|:-------:|
| lemon-drop-martini-kit          |  ✓    |   ✓      |     |   ✓     |
| flavored-margarita-trio         |  ✓    |   ✓      |     |   ✓     |
| cosmopolitan-cocktail-kit       |  ✓    |   ✓      |     |   ✓     |
| rose-all-day-set                |  ✓    |          |     |   ✓     |
| white-wine-cheese-set           |  ✓    |          |     |   ✓     |
| champagne-chocolate-celebration |  ✓    |          |     |   ✓     |
| mimosa-brunch-kit               |  ✓    |   ✓      |     |   ✓     |
| the-chocoholic-box              |  ✓    |          |     |   ✓     |
| sparkling-sweet-zero-proof      |  ✓    |          |  ✓  |   ✓     |
| self-care-and-sip               |  ✓    |          |  ✓  |   ✓     |
| vodka-martini-gift-set          |  ✓    |   ✓      |     |   ✓     |
| moscow-mule-gift-set            |  ✓    |   ✓      |     |   ✓     |
| bloody-mary-gift-set            |  ✓    |   ✓      |     |   ✓     |
| classic-gin-tonic-set           |  ✓    |   ✓      |     |   ✓     |

## Step 5 — Live test
On a cocktail product page: select a snack + a cocktail mixer + a bow, Add to Cart,
confirm all land in one cart/add.js call (the bb-product-addons handler batches them).

## Pricing reference (margins)
Spa: Body Scrub $40.95 (60%), Body Butter $40.95 (60%), Face Mask $30.95 (70%),
Candle $29.95 (70%). Snack/cocktail/bow use existing retail prices. Fees:
Shipping Insurance $4.95, Adult Signature $5.99.

## COMPLIANCE [REVIEW]
ATTORNEY: Adult Signature Fee wording + fee legality per destination state must be
reviewed before launch (same as other alcohol compliance scaffolding).
