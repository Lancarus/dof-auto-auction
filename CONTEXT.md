# DOF Auction Automation

This context describes the auction automation language used by the Frida modules for a DOF game server.

## Language

**Restock SQL**:
An import script that seeds **Market Item Profiles** for automated auction restocking.
_Avoid_: auction_main import, live listing SQL

**Market Item Profile**:
A per-item market policy that defines whether and how the auction automation should trade or restock an item.
_Avoid_: whitelist row, iteminfo row

**Live Auction Listing**:
An active row in the normal auction house that can be bought by players.
_Avoid_: restock SQL, profile

**Stackable Material**:
A stackable item whose PVF stackable type represents market materials, including material, material expert job, enchant waste, waste, and unlimited waste.
_Avoid_: consumable

**Stackable Consumable**:
A stackable item whose PVF stackable type is not a **Stackable Material**.
_Avoid_: material

**Auctionable Item Name**:
An item display name that is present and does not mark the item as old.
_Avoid_: empty name, old item name

**Auctionable Equipment Rarity**:
An equipment rarity value below 4 in this PVF export.
_Avoid_: rarity 4+ equipment

**Stackable Market Tier**:
A stackable item priority band derived from stackable type first, then PVF rarity.
_Avoid_: equipment rarity rule

## Relationships

- A **Restock SQL** imports one or more **Market Item Profiles**.
- A **Market Item Profile** can produce zero or more **Live Auction Listings** through the auction bot restocker.
- A **Live Auction Listing** belongs to the normal auction house, not to the profile catalogue.
- A **Stackable Consumable** is bounded by its PVF price when an automatic price is generated.
- A **Stackable Material** uses a deliberately volatile generated market price.
- A **Market Item Profile** should only be created for an item with an **Auctionable Item Name**.
- Equipment **Market Item Profiles** are only created for **Auctionable Equipment Rarity** values.
- A **Stackable Market Tier** places rarity 3+ stackable items in A tier, rarity 2 stackable items at least in B tier, and rarity 0-1 stackable items by stackable type.

## Example Dialogue

> **Dev:** "Should the PVF export write directly into the auction table?"
> **Domain expert:** "No. The **Restock SQL** should create **Market Item Profiles**; the restocker turns those into **Live Auction Listings**."

## Flagged Ambiguities

- "补货 SQL" was used ambiguously for direct auction rows and profile import rows; resolved: **Restock SQL** means importing **Market Item Profiles**.
- "材料" was narrowed to **Stackable Material**; all other PVF stackable types are **Stackable Consumables**.
- Item names that are empty or contain "旧" are excluded from generated **Market Item Profiles**.
- Equipment rarity was corrected for this PVF export: rarity 4 and above is excluded, rarity 2 targets 5-10 stock, and rarity 3 targets 2-4 stock.
- Stackable rarity thresholds were lowered by one compared with the earlier draft: rarity 3+ enters A tier, rarity 2 enters at least B tier, and rarity 0-1 falls back to stackable type.
