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

**Database**: Uses `taiwan_cain_auction_cera.auction_main` (game auction table) and `frida.*` tables (auction_whitelist, auction_system_config, auction_bot_characters, auction_bot_config, auction_bot_log, auction_price_history, pending_mail). All tables auto-created on init.

**Key GM commands**: `//au status`, `//au snip|list|bid|restock on|off|now`, `//au config <key> [value]`, `//au char add|remove|role <name>`, `//au stats <itemId>`, `//au reload`.

**Hook**: Chat address `0x820BBDE` (attaches alongside `gm-command.js` via hook chaining).
