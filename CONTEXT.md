# DNF Frida Automation

This context describes the domain language for server-side automation that shapes the auction house and dummy-player presence.

## Language

**Auction Bot**:
The server-side automation system that performs market actions in the normal auction house.
_Avoid_: Robot, dummy service

**Bot Character**:
A real game character record that the automation may use as an actor identity.
_Avoid_: Fake player, online dummy

**Bot Character Enrollment**:
The act of registering an existing game character for automation use.
_Avoid_: Character creation, account generation

**Robot Account Marker**:
The database flag that identifies accounts created for dummy automation.
_Avoid_: Online status

**Bot Character Seed**:
A database-backed account and character record generated for automation but not logged in.
_Avoid_: Online Dummy, login session

**Seed Probe**:
The first single bot character seed generated to validate database compatibility before cohort generation.
_Avoid_: Bulk generation

**Appearance Enrichment**:
Optional changes to a bot character's visual data after the base character already exists.
_Avoid_: Seed generation

**Presence Bot**:
A server-side simulated dummy that creates player-visible activity without a full client session.
_Avoid_: Logged-in user, CUser

**Visible Town Dummy**:
A dummy that appears as a real character model in a client town scene.
_Avoid_: Bot Placement, broadcast-only dummy

**Projected Town Dummy**:
A visible town dummy rendered by injecting server-to-client town packets without creating a full user session.
_Avoid_: Online Dummy, full CUser

**Dummy Snapshot**:
A batch of projected dummy state sent to a real player's client after entering the game world.
_Avoid_: Area-change sync, live login

**Global Dummy Snapshot**:
A dummy snapshot that includes every configured projected dummy regardless of the receiving player's current town.
_Avoid_: Local snapshot, area-filtered snapshot

**Dummy Cohort**:
The total configured group of projected dummies generated for a snapshot cycle.
_Avoid_: Batch, page

**Spawn Zone**:
A configured town area and coordinate range where projected dummies may stand.
_Avoid_: Dungeon map, live position

**Spawn Zone Import**:
The act of loading spawn zones from the dummy tool's map configuration into Frida-owned configuration.
_Avoid_: Runtime dependency on dummy config files

**Town Packet Probe**:
A diagnostic module that observes real town packets before projected dummy packets are implemented.
_Avoid_: Projection implementation

**Online Dummy**:
A dummy backed by a real logged-in session and full server user object.
_Avoid_: Presence Bot

**Bot Broadcast**:
A server-originated chat-like message attributed to a bot identity.
_Avoid_: Player chat, ordinary chat

**Synthetic Auction Listing**:
An auction row created by automation without a logged-in player session.
_Avoid_: Player listing, store listing

## Relationships

- An **Auction Bot** may use many **Bot Characters** as actor identities.
- **Bot Character Enrollment** registers one existing **Bot Character**.
- The **Robot Account Marker** is `d_taiwan.accounts.isRobot = 1`.
- A **Bot Character Seed** creates one **Bot Character**.
- A **Seed Probe** must succeed before generating a 300 to 500 character **Dummy Cohort**.
- **Appearance Enrichment** may add pets to existing **Bot Characters**.
- A **Presence Bot** may be backed by one **Bot Character**.
- A **Presence Bot** may produce **Bot Broadcasts**.
- A **Visible Town Dummy** must be visible in at least one town scene.
- A **Projected Town Dummy** is a kind of **Visible Town Dummy**.
- A **Dummy Snapshot** contains one or more **Projected Town Dummies**.
- A **Global Dummy Snapshot** contains all configured **Projected Town Dummies**.
- A **Dummy Cohort** should contain 300 to 500 **Projected Town Dummies** in the first visible-town implementation.
- **Spawn Zone Import** creates **Spawn Zones** from the dummy tool's `地图.json`.
- A **Town Packet Probe** must identify the real town appearance packet before **Projected Town Dummies** are sent.
- An **Online Dummy** requires a logged-in session; a **Presence Bot** does not.
- A **Synthetic Auction Listing** may be attributed to a **Bot Character** without that character being online.

## Example Dialogue

> **Dev:** "When the **Auction Bot** restocks an item, does it need a logged-in dummy?"
> **Domain Expert:** "No, a **Synthetic Auction Listing** can be written directly as long as the auction service accepts its owner fields."

## Flagged Ambiguities

- "假人" has been used to mean both **Bot Character** and **Online Dummy**; resolved: street-standing requires **Visible Town Dummies**.
- The user later confirmed dummy character data already exists; resolved: prefer **Bot Character Enrollment** from the database, with optional pet **Appearance Enrichment**.
- "喊话" was used ambiguously for ordinary player chat and broadcast-style activity; resolved: the first phase implements **Bot Broadcasts**.
- "客户端可见真实角色模型" could mean either a full online user or a packet-level projection; resolved: the first visible-town implementation targets **Projected Town Dummies**.
- "站街同步" was considered as area-change based projection; resolved: send a **Global Dummy Snapshot** when a real player enters the game world.
