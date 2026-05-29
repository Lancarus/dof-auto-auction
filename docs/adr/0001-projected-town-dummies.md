# Use projected town dummies instead of external dummy clients

We will generate database-backed bot character seeds and render them as projected town dummies by injecting server-to-client town packets, rather than running an external dummy VM/login client or constructing full `CUser` sessions in the game server. This keeps the auction-bot extension self-contained while still targeting client-visible town character models, at the cost of treating dummy visibility as a packet-level projection instead of a fully interactive online player.

## 2026-05-29 hook ownership note

`GameWorld::reach_game_world` is already used by existing modules such as `rank`. The Frida hook registry supports multiple attach callbacks at the same address, but only logs the first interceptor creation, so later modules may appear not to hook even when their callbacks are appended. For projected dummy experiments, the proven entry point is `town-dummy-probe`, which already logs `capture start` for GM world entry and owns the packet tracing hooks. One-shot projection tests should run from that probe until the town protocol is proven, then be promoted into a single shared world-entry dispatcher rather than adding independent `reach_game_world` hooks to feature modules.

## 2026-05-30 packet projection finding

Manual packet projection can create a client object with a minimal `0:2 B:0` plus `0:23` sequence, but that object renders as a naked/default model without name, level, job, or avatar fidelity. Additional profile/detail packets (`0:70`, `1:70`, `0:2 B:2`) do not enrich that object.

Replaying captured full appearance packets is not a viable standalone path:

- Captured `0:2 B:1` world snapshots disconnect the client when replayed with only the object id changed.
- Captured full `0:2 B:0` records can also disconnect when replayed as a new offline object.
- Replaying the captured pre-`B:0` `0:561` binary sequence plus captured `B:0` plus `0:23` does not render a new model.
- Calling `GameWorld::send_AllBasicInfo` from a GM command context records the function call but does not produce a fresh `0:2` packet for a synthetic object.

Conclusion: visible, dressed town models are tied to a valid server-side world-object lifecycle, not just to the downlink packet bytes. The original ADR preference for pure packet projection is now constrained: packet projection is acceptable only for tracer-bullet diagnostics or naked placeholder objects. The implementation path for production-quality visible town dummies must move to a server-owned presence object, lightweight online/session object, or a hook that inserts a dummy into the `GameWorld` object list before the server's own `send_AllBasicInfo`/movement broadcast path runs.

The referenced `dummy` project confirms this boundary: its WPF manager controls a separate fake-player service over HTTP/TCP (`RobotHttp` message types for create, login, remove, move, speak), rather than merely sending town projection packets from the game server process.

## 2026-05-30 clone-packet safety finding

Borrowing a real online `CUser` to generate `CUser::make_basic_info` for the receiver works as a diagnostic call (`ok=1`), but it does not create a second visible model when the source object already exists on the client. The client treats it as data for the already-known world object.

Attempts to clone the source by changing the object id are unsafe:

- Changing only the follow-up movement/enter object id produces no model because the `0:2` basic-info object id and movement object id do not match.
- Trying to alter the real enter-world basic-info object id for `#44` caused that client to crash on login.
- The `observed` CUser cache only fills during real enter-world basic-info generation, not merely when another player walks into the same screen, which reinforces that the captured path is a world-entry snapshot path rather than a reusable local spawn path.

Decision update: do not continue with object-id rewriting or real-player clone packet experiments. Those tests are now treated as dangerous diagnostics and are disabled. The next implementation path is a server-side presence object registered through the same world lifecycle structures the game server uses for real players, or a separate service that creates lightweight online/session objects comparable to the external `dummy` project.
