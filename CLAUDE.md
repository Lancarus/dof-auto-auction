# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A modular Frida-Gadget framework for a DNF (Dungeon & Fighter) game server. It injects `frida.so` via `LD_PRELOAD` into the server process and runs JavaScript modules that hook game functions using Frida's `Interceptor` API. There is no build step, package manager, or test runner — the code runs directly inside Frida-Gadget's JavaScript environment.

## Architecture

### Core Engine ([frida.js](frida.js))

The entire framework runtime lives in a self-executing closure (`globalContext`). Key subsystems:

- **mini-require** (`_require`) — Module loader akin to Node.js `require`. Reads `.js` files via native Linux `fopen`/`fread`, wraps them in `new Function("module", "context", src)`, caches exports in `_moduleCache`. Modules do NOT cross-reference each other; all shared APIs live on the `context` object.

- **Hook manager** (`_hookManager`) — Wraps Frida's `Interceptor.attach` and `Interceptor.replace`. Multiple modules can `attach` to the same address (callbacks are chained). `replace` is exclusive — only one module can replace a given address, and it cannot coexist with an `attach` on the same address.

- **Module manager** (`_moduleManager`) — Loads/unloads/reloads modules from config. Base modules (`isBaseModule: true`) export their API to `context.<moduleName>`. On unload, it calls `module.exports.dispose()`, unregisters hooks, and removes the context key.

- **Logging** — `log(level, ...msg)` writes to console (WARN/ERROR only) and to date+channel-named log files under the configured `_logDir`.

- **RPC entry** — `rpc.exports.init(stage, parameters)` is called by Frida-Gadget. On `'early'` stage, it waits for the server to initialize (hooks `check_argv` at `0x829EA5A`), then calls `_start()`. On hot-reload, it calls `_start()` directly.

### Module Types (from [frida_config.json](frida_config.json))

| Type | Config location | Purpose | Context key |
|------|----------------|---------|-------------|
| Core | `base.modules` | System-level (DB, thread scheduling, packet I/O) | `context.<name>` |
| Base library | `base.modules` | Game API wrappers (CUser, GameWorld, inventory) | `context.<name>` |
| Feature | `modules` | Gameplay features (GM commands, equipment mods, etc.) | — |

### Module Contract

Every module file receives `(module, context)` and writes to `module.exports`:

```javascript
module.exports = {
    init() { /* called after load, before hooks registered */ },
    dispose() { /* called before unload */ },
    api: { /* base modules: exposed as context.<moduleName> */ },
    hooks: [
        {
            address: "0x12345678",
            onEnter(args) { },
            onLeave(retval) { }
        },
        {
            address: "0x87654321",
            replace(arg1) { return newValue; },
            retType: 'int',
            argTypes: ["pointer"]
        }
    ]
};
```

### Shared Context

- `context.main` — `log`, `LOG_LEVELS`, `readFile`, `loadConfig`, `api_mkdir`, `module.reload()`, `module.reinit()`
- `context.config` — The `common` object from `frida_config.json`
- `context.system` — Thread scheduling, packet building, time utilities (from `core-system-manager.js`)
- `context.mysql` — DB connections, queries, game/frida data services (from `core-mysql-database.js`)
- `context.utils` — All game API wrappers (from `game-utils.js`)
- `context['utils.cuser']`, `context['utils.gameWorld']`, etc. — Specific game object wrappers
- `context['utils.auction']` — Auction house DB helpers, mail, price history (from `base-auction.js`)

### Hook Patterns

- **Attach** — Chained `onEnter`/`onLeave` callbacks. Same module can't register duplicates for the same address. Errors in one callback don't break others.
- **Replace** — Exclusive. Must declare `retType` and `argTypes` for `NativeCallback`. `Interceptor.revert()` restores the original on unload.

### Key Design Rules

1. Base modules MUST NOT reference each other via context (avoid circular dependencies). If unavoidable, order them in `frida_config.json` by load dependency.
2. Feature modules should access base APIs via `context.<moduleName>` rather than destructuring, so hot-reload of the base module doesn't require reloading dependent modules.
3. Modules with `freeze: true` in config are skipped during `//reload` (unload/load cycle). They still unload on `//reload cfg` and full system init.
4. Addresses in `hooks[].address` are raw hex strings of game binary offsets. They must match the specific server build.

## File Naming Conventions

| Prefix | Location | Purpose |
|--------|----------|---------|
| `core-*.js` | `lib/core/` | System-level modules (DB, threading, packets) |
| `base-*.js` | `lib/` | Game object wrappers (CUser, GameWorld) |
| `extend-*.js` | `lib/` | Extended wrappers built on base wrappers |
| `game-utils.js` | `lib/` | Central registry of NativeFunction declarations |
| (any).js | `module/` | Feature modules |

## Configuration

- `frida_config.json` — Module list and `common` settings (GM character IDs, etc.)
- `frida.config` — Frida-Gadget config; must point `interaction.path` to `frida.js` and set `on_change: "reload"`
- Key paths in `frida.js`: `_configPath = '/plugins/frida/frida_config.json'`, `_logDir = '/plugins/frida/log/'`

## GM Reload Commands

| Command | Effect |
|---------|--------|
| `//reinit` | Re-read config, reload base modules only |
| `//reload` | Reload all non-frozen feature modules |
| `//reload <name>` | Reload a specific module |
| `//reload cfg` | Reinit + reload all (updates config) |
| `//reload <name> cfg` | Reinit + reload specific module with new config |

## Auction Bot Module ([module/auction-bot.js](module/auction-bot.js))

Auction house automation via fake player characters. Controlled through `//au` prefixed GM commands.

**Architecture**: Base module [lib/base-auction.js](lib/base-auction.js) exports DB helpers to `context['utils.auction']`. Feature module `auction-bot.js` has four engines (sniper, lister, bidder, restocker) driven by a unified timer.

**Database**: Uses `taiwan_cain_auction_gold.auction_main` for the normal auction house. `taiwan_cain_auction_cera` is the gold consignment / CERA auction service and is handled by `df_point_r`, not this normal auction bot. Frida-owned metadata stays in `frida.*` tables (auction_whitelist, auction_system_config, auction_bot_characters, auction_bot_config, auction_bot_log, auction_price_history, pending_mail). All Frida tables are auto-created on init.

**Key GM commands**: `//au status`, `//au snip|list|bid|restock on|off|now`, `//au config <key> [value]`, `//au char add|remove|role <name>`, `//au stats <itemId>`, `//au reload`.

**PVF tradeable profile export**: [export_tradeable.py](export_tradeable.py) reads PVF exports from `G:\dnfsifu\develop\pvfTiqu` by default and generates `tradeable_item_profile_import.sql` plus `tradeable_items.json`. Run it through the repo virtual environment, e.g. `.\.venv\Scripts\python.exe export_tradeable.py --pvf-root G:\dnfsifu\develop\pvfTiqu`. It uses only the Python standard library.

The export SQL seeds `frida.auction_item_profile`; it must not directly create `taiwan_cain_auction_gold.auction_main` rows. Initial imports intentionally `DELETE FROM auction_item_profile` and rebuild the generated profile set. Generated JSON/SQL and `.venv/` are ignored by git.

The restocker reads `auction_item_profile` directly for enabled A/B tier profiles and no longer limits the profile scan to 300 rows. Each restock tick inserts auction rows until `max_restocks_per_cycle` is reached or all profiles are satisfied. The default is 500 rows per tick, and this cap is not multiplied by peak/off-peak behavior simulation. Existing databases may still contain the old `auction_bot_config.max_restocks_per_cycle` value because defaults are inserted with `INSERT IGNORE`; update that config explicitly when deploying this behavior.

PVF export rules currently agreed for this repo:
- `item_id` must come from `equipment.lst` / `stackable.lst`; unmapped files are skipped.
- Only `attach type` values `[free]` and `[sealing]` are auction-profile candidates.
- Empty names and names containing `旧` or `舊` are skipped.
- Equipment `rarity >= 4` is skipped. Equipment `rarity == 2` and level >= 40 is B tier with stock target 5-10. Equipment `rarity == 3` and level >= 40 is A tier with stock target 2-4. Lower-value equipment is C tier.
- Equipment base price is `value / 5` multiplied by the equipment group, level, rarity, inherited-name, and set-bonus factors documented in `export_tradeable.py`; do not use PVF `price` as the equipment base price.
- Stackable materials are `material`, `material expert job`, `enchant waste`, `waste`, and `unlimited waste`; they use deterministic 100-25000 generated prices.
- Other stackable types are consumables. If a consumable has `price`, generated price is bounded by it. Priceless consumables are imported only when their stackable type is allowlisted in the script.
- Stackable tier thresholds are lowered by one from the earlier draft: rarity >= 3 is A tier, rarity == 2 is at least B tier, and rarity <= 1 falls back to stackable-type tiering.
- `preferred_stack_max` is capped at `min(stack limit, 100)` because restock rows with larger `add_info` have not been validated.

**Auction service restart**: On the VM, `/root/run2` restarts only the normal auction service (`df_auction_r`) for `auction_siroco.cfg` and validates that port `30803` is listening. It does not restart `df_point_r`; point/CERA service listens on `30603` and uses `point_siroco.cfg`.

**`auction_main` write constraints**:
- `expire_time` is stored as a Unix timestamp. Queries must compare it with `UNIX_TIMESTAMP()`, not `NOW()`.
- Do not create normal-auction restock rows with `owner_type=1, owner_id=0`; `df_auction_r` can exit during startup with `Fail to RegistItem() from DB. process exits.`
- `owner_type=0` rows are accepted, but `df_auction_r` rejects too many active rows for the same `owner_id` and item. Probes on `item_id=3037` showed 2 and 5 rows for one owner start successfully, while 10 rows for the same owner reproduce `Fail to RegistItem()`. Ten rows with distinct owners start successfully.
- Restock rows therefore use GMTool-style distinct owners instead of a single configured seller character: ASCII `owner_name='GMTool'`, `owner_type=0`, and a generated `owner_id/owner_nexon_id`.
- Keep stackable restock rows at valid stack sizes. For `item_id=3037`, `add_info=100` is known to register.
- Avoid non-ASCII `owner_name` in direct `auction_main` writes. Badly encoded owner names produced `iconv error` during auction service startup.

**Hook**: Chat address `0x820BBDE` (attaches alongside `gm-command.js` via hook chaining).
