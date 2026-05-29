/**
 * auction-bot.js
 * 拍卖行机器人 - 自动上架、狙击、竞价、补货、价格波动
 * 通过 //au 系列GM指令控制
 * 20260526
 */

/** 模块配置 */
var _config = {
    gmAuth: context.config.gmCid,
    // 引擎默认间隔（秒），可通过DB配置覆盖
    snipingInterval: 1200,
    listingInterval: 900,
    biddingInterval: 1800,
    restockingInterval: 1800,
    mailPollInterval: 60,
    priceSnapshotInterval: 3600,
    // 默认阈值
    snipingPriceRatio: 0.70,
    listingProfitMargin: 1.30,
    // 每轮上限
    maxSnipesPerCycle: 20,
    maxListingsPerCycle: 10,
    maxBidsPerCycle: 5,
    maxRestocksPerCycle: 15,
    // 行为模拟
    enableBehaviorSim: true,
    priceRandomization: 0.15
};

////////////////////////////////////////////////////////////////////////
// 接口
////////////////////////////////////////////////////////////////////////

const { log } = context.main;
const { INFO, WARN, ERROR } = context.main.LOG_LEVELS;

const { api_ScheduleOnMainThread, api_ScheduleOnMainThread_Delay } = context.system.thread;
const { api_CSystemTime_getCurSec, getTimestamp } = context.system.time;
const { get_rand_int, strlen } = context.system.common;

const { CUserCharacInfo_GetCurCharacNo, getUserPosition } = context.utils.cuserCharacInfo;
const { api_CUser_SendNotiPacketMessage, CUser_Send } = context.utils.cuser;
const {
    api_PacketBuf_Get_Buf,
    api_PacketGuard_PacketGuard,
    InterfacePacketBuf_Put_Header,
    InterfacePacketBuf_Put_Byte,
    InterfacePacketBuf_Put_Short,
    InterfacePacketBuf_Put_Int,
    InterfacePacketBuf_Put_Str,
    InterfacePacketBuf_Put_Binary,
    InterfacePacketBuf_Finalize,
    Destroy_PacketGuard_PacketGuard
} = context.system.packet;

// 拍卖行API
const auction = context.utils.auction;
const _G_GameWorld = new NativeFunction(ptr(0x80DA3A7), 'pointer', [], { "abi": "sysv" });
const _GameWorld_send_AllBasicInfo = new NativeFunction(ptr(0x86C83FC), 'void', ['pointer', 'pointer'], { "abi": "sysv" });
const _GameWorld_reach_game_world = new NativeFunction(ptr(0x86C4E50), 'bool', ['pointer', 'pointer'], { "abi": "sysv" });
const _GameWorld_leave_game_world = new NativeFunction(ptr(0x86C5288), 'bool', ['pointer', 'pointer'], { "abi": "sysv" });
const _CUser_make_basic_info = new NativeFunction(ptr(0x865A44E), 'bool', ['pointer', 'pointer', 'int'], { "abi": "sysv" });
const _G_CGameManager = new NativeFunction(ptr(0x80CC18E), 'pointer', [], { "abi": "sysv" });
const _CGameManager_createUser = new NativeFunction(ptr(0x8294296), 'pointer', ['pointer'], { "abi": "sysv" });
const _CGameManager_returnUserPool = new NativeFunction(ptr(0x8294B2C), 'void', ['pointer', 'pointer'], { "abi": "sysv" });
const _CGameManager_insert_game_world = new NativeFunction(ptr(0x8296D30), 'bool', ['pointer', 'pointer'], { "abi": "sysv" });
const _CUser_GetUID = new NativeFunction(ptr(0x80C8C96), 'uint32', ['pointer'], { "abi": "sysv" });
const _CUser_get_acc_id = new NativeFunction(ptr(0x80DA36E), 'uint32', ['pointer'], { "abi": "sysv" });
const _CUser_get_unique_id = new NativeFunction(ptr(0x80DA37C), 'uint16', ['pointer'], { "abi": "sysv" });
const _CUser_SetCharacInfo = new NativeFunction(ptr(0x8649C6A), 'void', ['pointer', 'int', 'pointer'], { "abi": "sysv" });
const _CUser_SelectCharac = new NativeFunction(ptr(0x864CD92), 'bool', ['pointer', 'int', 'int'], { "abi": "sysv" });
const _CUser_select_charac_set_visible_values = new NativeFunction(ptr(0x868BF14), 'void', ['pointer', 'int'], { "abi": "sysv" });
const _CUser_SetInventory = new NativeFunction(ptr(0x864D160), 'bool', ['pointer', 'pointer'], { "abi": "sysv" });
const _CUser_GetInventory = new NativeFunction(ptr(0x864D646), 'bool', ['pointer', 'pointer'], { "abi": "sysv" });
const _CUserCharacInfo_getCurCharacR = new NativeFunction(ptr(0x8120432), 'pointer', ['pointer'], { "abi": "sysv" });
const _CUserCharacInfo_getCurCharacNo = new NativeFunction(ptr(0x80CBC4E), 'uint32', ['pointer'], { "abi": "sysv" });
const _CUserCharacInfo_getCurCharacName = new NativeFunction(ptr(0x8101028), 'pointer', ['pointer'], { "abi": "sysv" });
const _CUserCharacInfo_get_charac_job = new NativeFunction(ptr(0x80FDF20), 'int', ['pointer'], { "abi": "sysv" });
const _CUserCharacInfo_get_charac_level = new NativeFunction(ptr(0x80DA2B8), 'int', ['pointer'], { "abi": "sysv" });
const _CUserCharacInfo_getCurCharacGrowType = new NativeFunction(ptr(0x815741C), 'int', ['pointer'], { "abi": "sysv" });
const _CUserCharacInfo_IsCurCharacVisible = new NativeFunction(ptr(0x868BEE4), 'bool', ['pointer'], { "abi": "sysv" });

////////////////////////////////////////////////////////////////////////
// 变量
////////////////////////////////////////////////////////////////////////

var _running = false;
var _engines = {};
var _lastPriceSnapshot = 0;
var _lastMailPoll = 0;
var _configLoaded = false;
var _lastRestockerEnabled = false;
var _userGameWorlds = {};
var _observedUsersByCharacNo = {};
var _presenceWorldProbes = {};
////////////////////////////////////////////////////////////////////////
// 函数 - 工具
////////////////////////////////////////////////////////////////////////

/** 获取DB配置（带默认值回退） */
function _getConfigInt(key, defaultVal) {
    if (!auction.isReady || !auction.isReady()) return defaultVal;
    var val = auction.getBotConfig(key);
    return val !== null ? parseInt(val, 10) : defaultVal;
}

function _getConfigFloat(key, defaultVal) {
    if (!auction.isReady || !auction.isReady()) return defaultVal;
    var val = auction.getBotConfig(key);
    return val !== null ? parseFloat(val) : defaultVal;
}

function _getConfigBool(key, defaultVal) {
    if (!auction.isReady || !auction.isReady()) return defaultVal;
    var val = auction.getBotConfig(key);
    if (val === null) return defaultVal;
    return val === '1' || val === 'true';
}

function _probeCreateAndReturnPresenceUser() {
    var gm = _G_CGameManager();
    if (!gm || gm.isNull()) {
        throw new Error('G_CGameManager returned null');
    }

    var probeUser = _CGameManager_createUser(gm);
    if (!probeUser || probeUser.isNull()) {
        return {
            ok: false,
            game_manager: gm.toString(),
            user_ptr: '0x0',
            error: 'createUser returned null'
        };
    }

    var result = {
        ok: true,
        game_manager: gm.toString(),
        user_ptr: probeUser.toString(),
        uid: 0,
        acc_id: 0,
        unique_id: 0
    };

    try {
        result.uid = _CUser_GetUID(probeUser);
        result.acc_id = _CUser_get_acc_id(probeUser);
        result.unique_id = _CUser_get_unique_id(probeUser);
    } finally {
        _CGameManager_returnUserPool(gm, probeUser);
    }

    return result;
}

function _writeLoginCharacRecord(buf, seed) {
    Memory.protect(buf, 0x94, 'rw-');
    for (var i = 0; i < 0x94; i++) buf.add(i).writeU8(0);

    buf.add(0x00).writeU32(seed.charac_no || 0);

    var namePtr = Memory.allocUtf8String(seed.charac_name || ('dummy_' + seed.charac_no));
    var nameLen = Math.min(strlen(namePtr), 0x1d);
    Memory.copy(buf.add(0x04), namePtr, nameLen);
    buf.add(0x04 + nameLen).writeU8(0);

    buf.add(0x18).writeU8(Math.max(0, Math.min(255, seed.job || 0)));

    // The login-list record is 0x94 bytes. These offsets are copied by
    // CUser::SetCharacInfo before it expands the record into _Charac_info.
    buf.add(0x19).writeU8(Math.max(0, Math.min(255, seed.grow_type || 0)));
    buf.add(0x1a).writeU16(Math.max(1, Math.min(95, seed.lev || 1)));
    buf.add(0x1c).writeU8(seed.delete_flag ? 1 : 0);
    buf.add(0x1d).writeU8(seed.expert_job || 0);
    buf.add(0x1e).writeU32(seed.village || 0);
    buf.add(0x22).writeU8(seed.delete_flag ? 1 : 0);
    buf.add(0x88).writeU32(seed.create_time || 0);
    buf.add(0x8c).writeU32(seed.last_play_time || 0);
    buf.add(0x90).writeU32(0);
}

function _safeReadCString(ptrValue, maxLen) {
    if (!ptrValue || ptrValue.isNull()) return '';
    try {
        return ptrValue.readUtf8String(maxLen || 32);
    } catch (e) {
        try {
            var bytes = [];
            var limit = maxLen || 32;
            for (var i = 0; i < limit; i++) {
                var b = ptrValue.add(i).readU8();
                if (b === 0) break;
                bytes.push(('0' + b.toString(16)).slice(-2));
            }
            return 'hex:' + bytes.join('');
        } catch (e2) {
            return 'read-failed';
        }
    }
}

function _probeLoadPresenceCharacter(seed) {
    var gm = _G_CGameManager();
    if (!gm || gm.isNull()) throw new Error('G_CGameManager returned null');

    var probeUser = _CGameManager_createUser(gm);
    if (!probeUser || probeUser.isNull()) {
        return { ok: false, error: 'createUser returned null', game_manager: gm.toString() };
    }

    var packetGuard = null;
    var result = {
        ok: false,
        game_manager: gm.toString(),
        user_ptr: probeUser.toString(),
        source_charac_no: seed.charac_no,
        source_name: seed.charac_name,
        set_ret: 0,
        select_ok: false,
        visible_before: false,
        visible_after: false,
        basic_ok: false,
        cur_ptr: '0x0',
        cur_no: 0,
        cur_name: '',
        cur_job: 0,
        cur_level: 0,
        cur_grow: 0,
        acc_id: 0,
        unique_id: 0
    };

    try {
        probeUser.add(0x704ac).writeU32(seed.m_id || 0);

        var rec = Memory.alloc(0x94);
        _writeLoginCharacRecord(rec, seed);
        _CUser_SetCharacInfo(probeUser, 1, rec);
        result.set_ret = 1;
        result.select_ok = _CUser_SelectCharac(probeUser, 0, -1);
        result.cur_ptr = _CUserCharacInfo_getCurCharacR(probeUser).toString();
        result.visible_before = _CUserCharacInfo_IsCurCharacVisible(probeUser);
        _CUser_select_charac_set_visible_values(probeUser, 1);
        result.visible_after = _CUserCharacInfo_IsCurCharacVisible(probeUser);

        result.cur_no = _CUserCharacInfo_getCurCharacNo(probeUser);
        var curNamePtr = _CUserCharacInfo_getCurCharacName(probeUser);
        result.cur_name = _safeReadCString(curNamePtr, 32);
        result.cur_job = _CUserCharacInfo_get_charac_job(probeUser);
        result.cur_level = _CUserCharacInfo_get_charac_level(probeUser);
        result.cur_grow = _CUserCharacInfo_getCurCharacGrowType(probeUser);
        result.acc_id = _CUser_get_acc_id(probeUser);
        result.unique_id = _CUser_get_unique_id(probeUser);

        packetGuard = api_PacketGuard_PacketGuard();
        result.basic_ok = _CUser_make_basic_info(probeUser, packetGuard, 0);
        result.ok = !!(result.select_ok && result.cur_no && result.basic_ok);
    } catch (e) {
        result.error = e && e.stack ? e.stack : '' + e;
        log(ERROR, '[auction-bot] presence load partial ' + JSON.stringify(result));
        throw e;
    } finally {
        if (packetGuard && !packetGuard.isNull()) {
            try { Destroy_PacketGuard_PacketGuard(packetGuard); } catch (e1) { }
        }
        _CGameManager_returnUserPool(gm, probeUser);
    }

    return result;
}

function _releasePresenceWorldProbe(key) {
    var entry = _presenceWorldProbes[key];
    if (!entry) return;
    delete _presenceWorldProbes[key];

    var result = {
        key: key,
        user_ptr: entry.user ? entry.user.toString() : '0x0',
        game_world: entry.gameWorld ? entry.gameWorld.toString() : '0x0',
        leave_ok: false,
        returned: false
    };

    try {
        if (entry.reached && entry.gameWorld && !entry.gameWorld.isNull() && entry.user && !entry.user.isNull()) {
            result.leave_ok = _GameWorld_leave_game_world(entry.gameWorld, entry.user);
        }
    } catch (e) {
        result.leave_error = e && e.stack ? e.stack : '' + e;
        log(ERROR, '[auction-bot] presence world leave failed: ' + result.leave_error);
    }

    try {
        if (entry.gameManager && !entry.gameManager.isNull() && entry.user && !entry.user.isNull()) {
            _CGameManager_returnUserPool(entry.gameManager, entry.user);
            result.returned = true;
        }
    } catch (e2) {
        result.return_error = e2 && e2.stack ? e2.stack : '' + e2;
        log(ERROR, '[auction-bot] presence world return failed: ' + result.return_error);
    }

    log(INFO, '[auction-bot] presence world released ' + JSON.stringify(result));
}

function _sendPresenceWorldProjection(key) {
    var entry = _presenceWorldProbes[key];
    if (!entry || !entry.receiver || !entry.user || entry.user.isNull()) return;

    var dummy = entry.dummy || {};
    var uniqueId = 0;
    try {
        uniqueId = _CUser_get_unique_id(entry.user);
        var ok0 = _sendRealUserBasicInfoPacket(entry.receiver, entry.user, 0);
        var ok1 = _sendRealUserBasicInfoPacket(entry.receiver, entry.user, 1);
        _sendDummyEntityEnterPacket(entry.receiver, dummy, uniqueId);
        log(INFO, '[auction-bot] presence world direct projection sent key=' + key +
            ' receiver=' + entry.receiver +
            ' source_user=' + entry.user +
            ' charac_no=' + (dummy.charac_no || 0) +
            ' unique=' + uniqueId +
            ' basic0=' + (ok0 ? 1 : 0) +
            ' basic1=' + (ok1 ? 1 : 0) +
            ' area=' + (dummy.area || 0) +
            ' x=' + (dummy.x || 0) +
            ' y=' + (dummy.y || 0));
    } catch (e) {
        log(ERROR, '[auction-bot] presence world direct projection failed key=' + key +
            ' err=' + (e && e.stack ? e.stack : e));
    }
}

function _probePresenceWorld(receiverUser, seed, ttlMs, cloneInventoryCharacNo) {
    var gameWorld = _getUserGameWorld(receiverUser);
    if (!gameWorld || gameWorld.isNull()) gameWorld = _G_GameWorld();
    if (!gameWorld || gameWorld.isNull()) throw new Error('receiver GameWorld is not known and G_GameWorld returned null');
    ttlMs = Math.max(1000, Math.min(300000, parseInt(ttlMs, 10) || 8000));

    var gm = _G_CGameManager();
    if (!gm || gm.isNull()) throw new Error('G_CGameManager returned null');

    var probeUser = _CGameManager_createUser(gm);
    if (!probeUser || probeUser.isNull()) return { ok: false, error: 'createUser returned null' };

    var key = 'presence-' + Date.now() + '-' + (seed.charac_no || 0);
    var entry = {
        key: key,
        gameManager: gm,
        gameWorld: gameWorld,
        user: probeUser,
        receiver: receiverUser,
        reached: false
    };
    _presenceWorldProbes[key] = entry;

    var result = {
        ok: false,
        key: key,
        user_ptr: probeUser.toString(),
        game_world: gameWorld.toString(),
        source_charac_no: seed.charac_no,
        set_ret: 0,
        select_ok: false,
        basic_ok: false,
        insert_ok: false,
        reach_ok: false,
        sent_all_basic: false,
        clone_inventory_charac_no: parseInt(cloneInventoryCharacNo, 10) || 0,
        clone_inventory_ok: false,
        set_inventory_ok: false,
        acc_id: 0,
        unique_id: 0,
        area: 0,
        x: 0,
        y: 0,
        ttl_ms: ttlMs
    };

    try {
        probeUser.add(0x704ac).writeU32(seed.m_id || 0);

        var rec = Memory.alloc(0x94);
        _writeLoginCharacRecord(rec, seed);
        _CUser_SetCharacInfo(probeUser, 1, rec);
        result.set_ret = 1;
        result.select_ok = _CUser_SelectCharac(probeUser, 0, -1);
        _CUser_select_charac_set_visible_values(probeUser, 1);

        if (result.clone_inventory_charac_no) {
            var sourceInventoryUser = _getObservedUser(result.clone_inventory_charac_no);
            if (!sourceInventoryUser || sourceInventoryUser.isNull()) {
                var onlineSource = auction.getOnlineCharacterInfo(result.clone_inventory_charac_no);
                if (onlineSource && onlineSource.user_ptr) sourceInventoryUser = ptr(onlineSource.user_ptr);
            }
            if (!sourceInventoryUser || sourceInventoryUser.isNull()) {
                throw new Error('inventory clone source #' + result.clone_inventory_charac_no + ' is not observed/online');
            }
            var invBuf = Memory.alloc(0x18000);
            Memory.protect(invBuf, 0x18000, 'rw-');
            for (var invI = 0; invI < 0x18000; invI++) invBuf.add(invI).writeU8(0);
            result.clone_inventory_ok = _CUser_GetInventory(sourceInventoryUser, invBuf);
            if (!result.clone_inventory_ok) throw new Error('CUser::GetInventory source #' + result.clone_inventory_charac_no + ' returned false');
            result.set_inventory_ok = _CUser_SetInventory(probeUser, invBuf);
            if (!result.set_inventory_ok) throw new Error('CUser::SetInventory on presence user returned false');
        }

        var receiverPos = getUserPosition(receiverUser) || {};
        var area = receiverPos.area || seed.area || 5;
        var x = (receiverPos.x || 900) + 80;
        var y = receiverPos.y || 300;
        probeUser.add(0x8cfbc).writeS32(area);
        probeUser.add(577468).writeS32(area);
        probeUser.add(577532).writeU16(Math.max(0, Math.min(65535, x)));
        probeUser.add(577534).writeU16(Math.max(0, Math.min(65535, y)));
        result.area = area;
        result.x = x;
        result.y = y;
        entry.dummy = {
            charac_no: seed.charac_no,
            area: area,
            x: x,
            y: y
        };

        var packetGuard = api_PacketGuard_PacketGuard();
        try {
            result.basic_ok = _CUser_make_basic_info(probeUser, packetGuard, 0);
        } finally {
            Destroy_PacketGuard_PacketGuard(packetGuard);
        }

        result.acc_id = _CUser_get_acc_id(probeUser);
        result.unique_id = _CUser_get_unique_id(probeUser);

        result.insert_ok = _CGameManager_insert_game_world(gm, probeUser);
        var insertedWorld = _getUserGameWorld(probeUser);
        if (insertedWorld && !insertedWorld.isNull()) {
            entry.gameWorld = insertedWorld;
            gameWorld = insertedWorld;
            result.game_world = insertedWorld.toString();
        }
        result.reach_ok = !!result.insert_ok;
        if (!result.insert_ok) {
            // Offline pool users do not have a real client session, so the
            // full enter-world path can fail while sending itemspace packets.
            result.reach_ok = _GameWorld_reach_game_world(gameWorld, probeUser);
        }
        entry.reached = !!result.reach_ok;
        if (!result.reach_ok) throw new Error('insert_game_world and reach_game_world both returned false');
        log(INFO, '[auction-bot] presence world reached key=' + key +
            ' user=' + probeUser + ' charac_no=' + seed.charac_no +
            ' acc=' + result.acc_id + ' unique=' + result.unique_id +
            ' insert=' + (result.insert_ok ? 1 : 0) +
            ' reach=' + (result.reach_ok ? 1 : 0) +
            ' ttl_ms=' + ttlMs);

        _GameWorld_send_AllBasicInfo(gameWorld, receiverUser);
        result.sent_all_basic = true;
        _sendPresenceWorldProjection(key);
        api_ScheduleOnMainThread_Delay(_sendPresenceWorldProjection, [key], 1000);
        result.ok = true;

        api_ScheduleOnMainThread_Delay(_releasePresenceWorldProbe, [key], ttlMs);
        return result;
    } catch (e) {
        result.error = e && e.stack ? e.stack : '' + e;
        log(ERROR, '[auction-bot] presence world partial ' + JSON.stringify(result));
        _releasePresenceWorldProbe(key);
        throw e;
    }
}

function _floorInt(value, floor) {
    value = parseInt(value, 10) || floor;
    return value < floor ? floor : value;
}

/** 从DB刷新配置 */
function _reloadConfig() {
    if (!auction.isReady || !auction.isReady()) {
        _engines.sniper.enabled = false;
        _engines.lister.enabled = false;
        _engines.bidder.enabled = false;
        _engines.restocker.enabled = false;
        return false;
    }

    try {
        _config.snipingInterval = _floorInt(_getConfigInt('sniping_interval_s', _config.snipingInterval), 900);
        _config.listingInterval = _floorInt(_getConfigInt('listing_interval_s', _config.listingInterval), 300);
        _config.biddingInterval = _floorInt(_getConfigInt('bidding_interval_s', _config.biddingInterval), 900);
        _config.restockingInterval = _floorInt(_getConfigInt('restocking_interval_s', _config.restockingInterval), 900);
        _config.mailPollInterval = _getConfigInt('mail_poll_interval_s', _config.mailPollInterval);
        _config.snipingPriceRatio = _getConfigFloat('sniping_price_ratio', _config.snipingPriceRatio);
        _config.listingProfitMargin = _getConfigFloat('listing_profit_margin', _config.listingProfitMargin);
        _config.maxSnipesPerCycle = _getConfigInt('max_snipes_per_cycle', _config.maxSnipesPerCycle);
        _config.maxListingsPerCycle = _getConfigInt('max_listings_per_cycle', _config.maxListingsPerCycle);
        _config.maxBidsPerCycle = _getConfigInt('max_bids_per_cycle', _config.maxBidsPerCycle);
        _config.maxRestocksPerCycle = _getConfigInt('max_restocks_per_cycle', _config.maxRestocksPerCycle);
        _config.priceRandomization = _getConfigFloat('price_randomization', _config.priceRandomization);
        _config.enableBehaviorSim = _getConfigBool('enable_behavior_sim', _config.enableBehaviorSim);

        _engines.sniper.enabled = _getConfigBool('sniping_enabled', false);
        _engines.lister.enabled = _getConfigBool('listing_enabled', false);
        _engines.bidder.enabled = _getConfigBool('bidding_enabled', false);
        _engines.restocker.enabled = _getConfigBool('restocking_enabled', false);
        if (_engines.restocker.enabled && !_lastRestockerEnabled) {
            _engines.restocker.lastRun = 0;
        }
        _lastRestockerEnabled = _engines.restocker.enabled;
        _configLoaded = true;
    } catch (e) {
        log(WARN, '[auction-bot] 配置加载失败，使用默认配置: ' + e);
        _engines.sniper.enabled = false;
        _engines.lister.enabled = false;
        _engines.bidder.enabled = false;
        _engines.restocker.enabled = false;
    }

    _engines.sniper.interval = _config.snipingInterval;
    _engines.lister.interval = _config.listingInterval;
    _engines.bidder.interval = _config.biddingInterval;
    _engines.restocker.interval = _config.restockingInterval;
    return _configLoaded;
}

// ---- 行为模拟 ----

/** 随机抖动（秒） */
function _jitter(base, range) {
    if (!_config.enableBehaviorSim) return base;
    var span = Math.max(1, range * 2000);
    return base + (get_rand_int(span) - range * 1000) / 1000;
}

/** 随机化价格 */
function _randomizePrice(basePrice) {
    if (!_config.enableBehaviorSim) return basePrice;
    var range = _config.priceRandomization;
    var factor = 1 + (Math.random() * 2 - 1) * range;
    return Math.floor(basePrice * factor);
}

/** 是否高峰时段 */
function _isPeakHour() {
    var hour = new Date().getHours();
    return (hour >= 10 && hour <= 14) || (hour >= 18 && hour <= 23);
}

/** 是否跳过本轮（5%概率，低谷时段10%） */
function _shouldSkipCycle() {
    if (!_config.enableBehaviorSim) return false;
    var rate = _isPeakHour() ? 0.03 : 0.10;
    return Math.random() < rate;
}

/** 高峰时段活跃度倍数 */
function _activityMultiplier() {
    if (!_config.enableBehaviorSim) return 1.0;
    return _isPeakHour() ? 1.5 : 0.7;
}

function _getMarketItems(limit, includeNoise) {
    var profiles = auction.getMarketProfiles(limit || 200, includeNoise || false);
    if (profiles && profiles.length > 0) {
        for (var i = 0; i < profiles.length; i++) {
            profiles[i].system_price = profiles[i].base_price;
            profiles[i].quantity = profiles[i].max_total_quantity || profiles[i].max_listings || 1;
            profiles[i].stack_size = profiles[i].preferred_stack_max || 1;
            profiles[i].upgrade = 0;
            profiles[i].endurance = 0;
            profiles[i].seal_flag = 0;
        }
        return profiles;
    }
    return auction.getWhitelistItems();
}

function _pickListingQuantity(profile) {
    var min = profile.preferred_stack_min || 1;
    var max = profile.preferred_stack_max || profile.stack_size || 1;
    max = Math.min(max, 100);
    min = Math.min(min, max);
    if (max >= 100) return 100;
    if (max < min) max = min;
    return min + Math.floor(Math.random() * (max - min + 1));
}

function _getAuctionOwnerName(botChar) {
    return 'bot_' + (botChar && botChar.charac_no ? botChar.charac_no : 'seller');
}

function _makeRestockOwner(itemId, sequence) {
    var ownerId = 9000000 + (itemId % 100000) * 100 + (sequence % 100);
    return {
        owner_id: ownerId,
        owner_name: 'GMTool',
        owner_type: 0,
        owner_nexon_id: String(ownerId)
    };
}

function _sendLines(user, lines, color) {
    for (var i = 0; i < lines.length; i++) {
        api_CUser_SendNotiPacketMessage(user, lines[i], color || 3);
    }
}

function _ptrKey(value) {
    return value ? value.toString() : '0';
}

function _rememberUserGameWorld(user, gameWorld) {
    if (!user || user.isNull() || !gameWorld || gameWorld.isNull()) return;
    _userGameWorlds[_ptrKey(user)] = gameWorld;
    log(INFO, '[auction-bot] remembered GameWorld user=' + user + ' game_world=' + gameWorld);
}

function _getUserGameWorld(user) {
    return _userGameWorlds[_ptrKey(user)] || null;
}

function _rememberObservedUser(user, reason) {
    if (!user || user.isNull()) return;
    try {
        var characNo = CUserCharacInfo_GetCurCharacNo(user);
        if (!characNo) return;
        _observedUsersByCharacNo[characNo] = {
            user: user,
            ptr: user.toString(),
            reason: reason || '',
            seen_ms: Date.now()
        };
        log(INFO, '[auction-bot] observed CUser charac_no=' + characNo +
            ' user=' + user + ' reason=' + (reason || ''));
    } catch (e) {
        log(WARN, '[auction-bot] remember observed CUser failed: ' + e);
    }
}

function _getObservedUser(characNo) {
    var entry = _observedUsersByCharacNo[parseInt(characNo, 10) || 0];
    return entry && entry.user ? entry.user : null;
}

function _listObservedUsers(limit) {
    var rows = [];
    for (var k in _observedUsersByCharacNo) {
        var entry = _observedUsersByCharacNo[k];
        rows.push({
            charac_no: parseInt(k, 10) || 0,
            user_ptr: entry.ptr,
            reason: entry.reason || '',
            seen_ms: entry.seen_ms || 0
        });
    }
    rows.sort(function (a, b) { return b.seen_ms - a.seen_ms; });
    return rows.slice(0, limit || 20);
}

function _stripPlusPrefix(value) {
    if (value === undefined || value === null) return value;
    value = String(value);
    return value.charAt(0) === '+' ? value.substring(1) : value;
}

function _parseItemIdArg(value) {
    value = _stripPlusPrefix(value);
    if (!value) return 0;
    var id = parseInt(value, 10);
    return isNaN(id) ? 0 : id;
}

function _putSizedString(packetGuard, value) {
    var text = value || '';
    var textPtr = Memory.allocUtf8String(text);
    var len = strlen(textPtr);
    InterfacePacketBuf_Put_Int(packetGuard, len);
    InterfacePacketBuf_Put_Str(packetGuard, textPtr, len);
}

function _putRawString(packetGuard, value) {
    var text = value || '';
    var textPtr = Memory.allocUtf8String(text);
    InterfacePacketBuf_Put_Str(packetGuard, textPtr, strlen(textPtr));
}

function _putCapturedOps(packetGuard, opsText, replacements) {
    var ops = opsText.split('|');
    for (var i = 0; i < ops.length; i++) {
        var op = replacements && replacements[i] !== undefined ? replacements[i] : ops[i];
        var sep = op.indexOf(':');
        if (sep <= 0) throw new Error('bad captured op: ' + op);

        var type = op.substring(0, sep);
        if (type === 'STR') {
            var rest = op.substring(sep + 1);
            var sep2 = rest.indexOf(':');
            var len = sep2 >= 0 ? parseInt(rest.substring(0, sep2), 10) : parseInt(rest, 10);
            var text = sep2 >= 0 ? rest.substring(sep2 + 1) : '';
            if (isNaN(len)) throw new Error('bad captured str len: ' + op);
            var textPtr = Memory.allocUtf8String(text);
            InterfacePacketBuf_Put_Str(packetGuard, textPtr, len);
            continue;
        }

        var value = parseInt(op.substring(sep + 1), 10);
        if (isNaN(value)) throw new Error('bad captured op value: ' + op);

        if (type === 'B') InterfacePacketBuf_Put_Byte(packetGuard, value);
        else if (type === 'S') InterfacePacketBuf_Put_Short(packetGuard, value);
        else if (type === 'I') InterfacePacketBuf_Put_Int(packetGuard, value);
        else throw new Error('unsupported captured op type: ' + type);
    }
}

function _hexToBytes(hex) {
    var out = [];
    for (var i = 0; i < hex.length; i += 2) {
        out.push(parseInt(hex.substring(i, i + 2), 16) & 0xff);
    }
    return out;
}

function _putHexBinary(packetGuard, hex) {
    var bytes = _hexToBytes(hex);
    var ptrBytes = Memory.alloc(bytes.length);
    ptrBytes.writeByteArray(bytes);
    InterfacePacketBuf_Put_Binary(packetGuard, ptrBytes, bytes.length);
}

function _sendDummyTownListTestPacket(user, dummy) {
    var packetGuard = api_PacketGuard_PacketGuard();
    try {
        InterfacePacketBuf_Put_Header(packetGuard, 1, 70);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Int(packetGuard, 1);

        _putSizedString(packetGuard, '一起来');
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, dummy.charac_no % 60000);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);

        _putSizedString(packetGuard, dummy.charac_name || ('dummy_' + dummy.charac_no));
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        _putRawString(packetGuard, '');

        InterfacePacketBuf_Put_Short(packetGuard, 70);
        InterfacePacketBuf_Put_Byte(packetGuard, dummy.area || 5);
        InterfacePacketBuf_Put_Byte(packetGuard, Math.max(0, Math.min(255, Math.floor((dummy.x || 1200) / 100))));
        InterfacePacketBuf_Put_Byte(packetGuard, Math.max(0, Math.min(255, Math.floor((dummy.y || 250) / 25))));
        InterfacePacketBuf_Put_Byte(packetGuard, 255);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Int(packetGuard, 0);

        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy town list test packet sent charac_no=' + dummy.charac_no +
            ' name=' + dummy.charac_name + ' area=' + dummy.area + ' x=' + dummy.x + ' y=' + dummy.y);
        return true;
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendDummyTownProfile70Packet(user, dummy, objectId) {
    objectId = objectId || 30;
    var packetGuard = api_PacketGuard_PacketGuard();
    try {
        InterfacePacketBuf_Put_Header(packetGuard, 0, 70);

        _putSizedString(packetGuard, '一起来');
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Byte(packetGuard, 11);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Short(packetGuard, dummy.charac_no % 60000);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 960000);
        InterfacePacketBuf_Put_Short(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 200);
        InterfacePacketBuf_Put_Byte(packetGuard, 6);
        InterfacePacketBuf_Put_Int(packetGuard, 201);
        InterfacePacketBuf_Put_Byte(packetGuard, dummy.area || 5);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        _putRawString(packetGuard, '');
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 32070);
        _putSizedString(packetGuard, dummy.charac_name || ('dummy_' + dummy.charac_no));

        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy town profile 0:70 packet sent object_id=' + objectId +
            ' charac_no=' + dummy.charac_no + ' name=' + dummy.charac_name + ' area=' + dummy.area);
        return true;
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendDummyBasicInfoPacket(user, dummy, objectId) {
    objectId = objectId || 30;
    var packetGuard = _makePacketGuard(0, 2);
    try {
        // Captured from GameWorld::send_AllBasicInfo for another town player entering the GM screen.
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, 1);
        InterfacePacketBuf_Put_Short(packetGuard, objectId);
        InterfacePacketBuf_Put_Int(packetGuard, dummy.charac_no || 6);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, Math.max(1, Math.min(95, dummy.lev || 15)));
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 10);
        InterfacePacketBuf_Put_Int(packetGuard, dummy.job || 27600);
        InterfacePacketBuf_Put_Int(packetGuard, 4);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 1);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 11);
        InterfacePacketBuf_Put_Int(packetGuard, dummy.grow_type || 9);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, dummy.area || 3);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 100);
        InterfacePacketBuf_Put_Short(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 255);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 255);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);

        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy basic info 0:2 packet sent object_id=' + objectId +
            ' charac_no=' + dummy.charac_no + ' area=' + dummy.area);
        return true;
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendRealUserBasicInfoPacket(user, sourceUser, mode) {
    mode = parseInt(mode, 10);
    if (isNaN(mode)) mode = 0;
    var packetGuard = _makePacketGuard(0, 2);
    try {
        InterfacePacketBuf_Put_Byte(packetGuard, mode);
        InterfacePacketBuf_Put_Short(packetGuard, 1);
        var ok = _CUser_make_basic_info(sourceUser, packetGuard, mode);
        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] real CUser make_basic_info packet sent target_user=' + user +
            ' source_user=' + sourceUser + ' mode=' + mode + ' ok=' + ok);
        return ok;
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

var _capturedTownSnapshotOps =
    'B:1|S:1|S:86|I:392619844|I:83|B:100|B:3|B:0|B:0|I:1690008|I:0|B:0|S:0|I:1600118|I:0|B:0|S:0|I:30|I:4|B:0|B:1|I:1690009|I:0|B:0|S:0|I:632360069|I:0|B:0|S:0|I:30|I:4|B:0|B:2|I:1690010|I:0|B:0|S:0|I:1620088|I:0|B:0|S:0|I:30|I:4|B:0|B:3|I:1690012|I:0|B:0|S:29|I:632300102|I:0|B:0|S:0|I:30|I:4|B:0|B:4|I:1690013|I:0|B:0|S:0|I:632310079|I:0|B:0|S:0|I:30|I:4|B:0|B:5|I:1690015|I:0|B:0|S:0|I:1670097|I:0|B:0|S:0|I:30|I:4|B:0|B:6|I:1690011|I:0|B:0|S:0|I:1630103|I:0|B:0|S:0|I:30|I:4|B:0|B:7|I:1690014|I:0|B:0|S:4|I:632330048|I:0|B:0|S:0|I:30|I:4|B:0|B:8|I:612380010|I:0|B:0|S:0|I:0|I:0|B:0|S:0|I:30|I:4|B:0|B:10|I:104040021|I:352772146|B:0|S:27|I:0|I:2682757|B:3|S:7|B:0|B:11|I:2747351|I:1409177144|B:0|S:0|I:0|I:0|B:0|S:0|B:0|B:12|I:11315|I:419259130|B:0|S:39|I:0|I:2026020761|B:0|S:0|B:0|B:13|I:250202|I:1012715058|B:0|S:31|I:0|I:2023889439|B:0|S:0|B:0|B:14|I:190169|I:1008247710|B:0|S:30|I:0|I:2026020763|B:0|S:0|B:0|B:15|I:370202|I:659471852|B:0|S:26|I:0|I:2023889194|B:0|S:0|B:0|B:16|I:315005|I:1099223058|B:0|S:23|I:0|I:2023889213|B:0|S:0|B:0|B:17|I:20188|I:1407899949|B:0|S:0|I:0|I:3671|B:0|S:0|B:0|B:18|I:22144|I:1315545994|B:0|S:0|I:0|I:0|B:0|S:0|B:0|B:19|I:420968|I:535962251|B:0|S:0|I:0|I:0|B:0|S:0|B:0|B:20|I:440345|I:24048|B:0|S:0|I:0|I:0|B:0|S:0|B:0|B:21|I:450114|I:962579311|B:0|S:0|I:0|I:0|B:0|S:0|B:0|B:22|I:63201|I:5|B:0|S:0|I:0|I:0|B:0|S:0|I:0|B:0|B:23|I:63512|I:1849308263|B:0|S:0|I:0|I:0|B:0|S:0|B:0|B:24|I:64003|I:480638092|B:0|S:0|I:0|I:0|B:0|S:0|B:0|B:25|I:20104068|I:273963728|B:0|S:0|I:0|I:0|B:0|S:0|B:0|B:0|B:0|B:40|B:28|B:75|B:21|B:36|B:23|B:107|B:8|B:45|B:18|B:14|B:22|B:197|B:1|B:27|B:1|B:47|B:1|B:13|B:5|B:12|B:36|B:4|B:1|B:44|B:1|B:34|B:1|B:21|B:10|B:41|B:1|B:93|B:10|B:73|B:1|B:181|B:2|B:184|B:3|B:179|B:7|B:174|B:1|B:254|B:1|B:92|B:1|B:194|B:11|B:169|B:1|B:178|B:10|B:186|B:10|B:190|B:1|B:147|B:5|B:215|B:5|B:62|B:10|B:39|B:26|B:108|B:3|B:71|B:16|B:97|B:5|B:38|B:21|B:200|B:6|B:201|B:5|B:0|B:4|B:1|B:47|B:1|B:169|B:1|B:12|B:1|B:27|B:1|B:197|B:1|B:44|B:1|B:93|B:1|B:181|B:2|B:184|B:3|B:179|B:7|B:174|B:1|B:254|B:1|B:92|B:1|B:194|B:11|B:200|B:6|B:201|B:5|B:19|B:6|B:6|B:6|B:6|B:6|B:6|B:6|B:0|B:3|B:0|B:5|B:14|B:0|S:27|B:1|S:27|B:3|S:27|B:2|S:27|B:4|S:5|B:9|S:12|B:5|S:5|B:6|S:5|B:12|S:11|B:8|S:20|B:10|S:12|B:7|S:20|B:11|S:10|B:13|S:10|B:2';

var _capturedFullBasicInfoOps =
    'B:0|S:1|S:587|I:12|B:5|B:18|B:70|B:0|B:0|B:0|B:0|B:0|I:1690008|I:4|B:0|I:1600118|I:0|B:1|I:1690009|I:4|B:0|I:632360069|I:0|B:2|I:1690010|I:4|B:0|I:1620088|I:0|B:3|I:1690012|I:4|B:0|I:632300102|I:0|B:4|I:1690013|I:4|B:0|I:632310079|I:0|B:5|I:1690015|I:4|B:0|I:1670097|I:0|B:6|I:1690011|I:4|B:0|I:1630103|I:0|B:7|I:1690014|I:4|B:0|I:632330048|I:0|B:8|I:612380010|I:4|B:0|I:0|I:0|B:10|I:104040021|I:4|B:1|I:0|I:2682757|B:11|I:2747351|I:4|B:0|I:0|I:0|B:0|B:0|I:1|B:0|I:63201|I:0|B:1|B:1|I:0|I:0|B:11|I:9|I:0|B:1|B:0|B:0|B:3|I:11|B:0|S:0|B:3|I:0|I:0|I:0|B:100|S:0|B:0|S:0|B:0|S:0|B:0|B:0|B:255|B:0';

var _capturedLifecycleB0Ops =
    'B:0|S:1|S:647|I:12|B:9|B:0|B:70|B:0|B:0|B:0|B:0|B:0|I:39150|I:4|B:0|I:0|I:1|B:1|I:39451|I:4|B:0|I:0|I:1|B:2|I:101570314|I:4|B:0|I:0|I:1|B:3|I:101500527|I:4|B:0|I:0|I:1|B:4|I:41217|I:4|B:0|I:0|I:1|B:5|I:42022|I:4|B:0|I:0|I:1|B:6|I:2684481|I:4|B:0|I:0|I:1|B:7|I:41437|I:4|B:0|I:0|I:1|B:8|I:42212|I:4|B:0|I:0|I:1|B:9|I:101590046|I:4|B:0|I:0|I:1|B:10|I:28272|I:4|B:21|I:0|I:0|B:11|I:26661|I:4|B:0|I:0|I:0|B:6|B:0|I:1|B:1|I:63019|I:0|B:1|B:0|I:0|I:0|B:11|I:9|I:0|B:1|B:0|B:0|B:3|I:569|B:0|S:0|B:3|I:0|I:0|I:0|B:100|S:0|B:0|S:0|B:0|S:0|B:255|B:0|B:255|B:0';

var _capturedLifecycle561Hex = [
    '0000003d0039001100066c2f4e00000002cde2ac2fb10915d21f3f2d2bdee34b6c73348078790198c1742e35e00f41f5fb1b57002a45a10b52dbd454df',
    '000000bb00b700110006d5193c00000013cad46256e07e679b6e27a027d963891e1db4b327782997df6c8cde37c594c9b8763f88c45330d4673caff89b94b664ea741bed6f8fd80ef0be1672705c9358c5e1fb7dd5b2e308161e17d2df1680c925460f880ecfde2e35b2a543c70fe677a5d11a3b6fda2201068d6e0a850ff4bdc1aa2583ff274e17aecd97c432187febdc98780013bf988dc12dd323f0161a9485cee3aef47a1f0334eed7b35c45eece1a02c6f2ec762c45afd645',
    '000000ee00ea00110006e51f12000000069b27774f2b748dd775f745ef00f175625895d6f5da140ffc061457c5c3c9787149776b81dd56e3b4172cf7cda9f153be8d6616868d442732c96babca4f6e0146930aa0c088884a55343b8211ed8bc71f3d70c2e6acc394ecdeeda72188884a55343b8211ed8bc71f3d70c2e6acc394ecdeeda72188884a55343b8211ed8bc71f3d70c2e6acc394ecdeeda72188884a55343b8211ed8bc71f3d70c2e6acc394ecdeeda72188884a55343b8211ed8bc71f3d70c2e6d635f8b93774dde9d635f8b93774dde98125e51e6ce63261755d71d4844d6c5b564235a152f2be931e',
    '00000594059000110007015a530000000b3e78cb15c113c8487e4fc062b3636069dc4b2f224968705c8b153b21f63401ce50623f20248b55e2c6afa5bed39294e42b1b62a3881c92577a5a25511822e1cf8c7fd752248b55e2c6afa5bed39294e42b1b62a33f6f21f519e1af371eedd0ac4cc1f34068d761ff4de35c4476e48ad4765079588f1682666b9ad2a41874b0ceb1bbbb75d1a3e95965029d8bb92a9a7af99cc1cabc482f11a52c1b1b0a2c7cd706897449fec909da3724ce70a4658a9d2bd9d4fddb68f60161b61bc4eab64752861fad84aa8ece602373ce480417145b0dd69c329efbda3bb1834806450cde547881ce3c25f547e3ccfa5b7b06be142b7a01fc8b660bfc6e967a2725570e95f3499ee7bb3816d1f537a7c495cb7b79a7cd4798efb409e0d6af683abc79b5405c14a67ea7c6a9112ed5cce01c062b2d5540c8e81c7f4ed62040c04296a890b60b00f6d046cef66fe5f03d40eaffa59248cd523537895ad66e334b4639eb7fc9521e4292cff0b851cb04e9302dc2fde5721f7190c14d5c0f61d67334f4159998d922a1d5770c4701ae5e9870e1e113554fac67dfcf8bb8751b3fdb8585cf9915ee32f6ce82efc280f240946b901501c6592703a4dc6cf0ec20e06ececb59d2860e41a05e352101d580458ebd50b29fe66c3a06be99600b839ff2ec067a264f079c9cc1360aac5e475866906dcf3d365a91cbbc5bcf4f59fb3403eb6eac555b98af7f01b23550a4b766409efbae954352498dcab7d2597309a6f9a49416d0a11c6468ffd81a32e3d3710c129abf05e311e6a0469aa324f9f36f148ca353cc276c4071eadf961efbe820b1b532af6c7b1bc94df177dce7e795e95d07e73c7cfcaa9def7d2517fe79509f54ee96b118996a41ef3437d2c19dce4dc6b75229fa7c6bd8a9de5839b1a242a4c7ad3c631a61407819b9ae87ad1be58c18b9ee06730d41888cfbd79aecd466966ed8b2cd1098e37f7d3f4a14d98488033494e6b1bf43e5a9ea249987ee289dbf9b9c9507b4e625a5acaa931a93fa577244020a5e2f0e9ca483a1fae7ea72b18a97382776b8ead78e039a0fffd3684c876ddfac2d711404260fe72e2dd84a98185ac5fe53070b5f818ee23935d277b8ca65687d012bbfd0f6d662bdf650081e084a254546de976ae0ce02f435c1f3ed8257905d4098dfb0362c80bd41aa23e5089d687d85bf320efc10ad0e43e88c3e5206167717ed81586304b18b476054640af829858d1fde0f9a2130fe4ed03604918513a8cd45be8f4fdcb09b97b9113567a43927bc5ed2274ce9fa705c40caa9779fb687babc1cf43757f58dfd5e80b7885e16b223f5353f541cbb6769e478bcaba589494e9a9ecb2876d71548a3c2700db495e87b5a358ecf482e531e96336fbb406b74c323cf061902cc6ad53722e8fb69f1b58a9f15a5c8dd3e7daf38e3a46a3aa7b9ae00409930664e657299f2a9a5d1477ba23366755f39045aad72c7918c99922ea1135ab1f272dfe8eacd203b6c65bcd88af37ec8a60bb0c1f468add90b30bf4a85201199069a562423f44bbb5a3a52598ac76db326ad62ff8f5da8a2f748acdfd0642f0575eb5bf365e56a7abb89f9516bd57f0279f0d4299139ae671c9740c5375a766b5f90eec54183dc98dce847aedcc5560e1383aa21b27c11587a835eb876199844abf89190994c7faedda9ed51d6bf8ec63ef220a9204e44bce92a5502a2bc74c63c61bf05a1ca77a09ba4d935f4ce3943465bda0e57d8178d7a623802891ab1a8f386956591dd0d150704a4c63f5cf7c7d0ef524d70619b4213a2e74ae3d1a4eeeeeb15f6290337b96e45603912ab9b1932c1cea76d5efc38c3529c04ccd4355eb2465cba7eed0c46b4758a2f3e13f83eb29c6cd14b50303c370ee8ce5a08049b6d24b2b6c2bad5ebde870b864f946f41c25585ba6eaa851f0debef78dfb806aa0962553b42872e83f97e6ffc8c078a29e4a6982ee149b6c4a8adc73481c5136788167e6b',
    '00000043003f001100073ea1b8000000021e38a7247495ed37ce6f912e194fb7b0a1606326f48c459a1b4bda3421b7e66629581ab69b81ed2c02eb18b0650cf77b8059',
    '0000003f003b001100075197c300000004ac65397831a2066fd3b240da0542132ceddc4e9e13b77fa2aec6eb82dc7cd52cb1bd00f025af81109de89a00815b',
    '0000005f005b0011000774a01e000000136a0b6251dc8f198e1ee376a5e57d71c8050212c0b4a3e6c99d0dc5b5f6650bad06fbb9a12fccd789d2525184cbbb08b6c0cb5ea3d34d10852ed34695db45188d26db4e9da33d60f55ea36a7752ea',
    '0000018f018b00110007ae40bc0000000f078dcd26745cfd93fbdfcc81c57159f89fa7ebda48c4ad6fffb2a83b3d8dbad89436553a98f224d09d74896ea9522384eae619f178b0545da55fd29974bea0aa1398fa3f6756daa2354b19157e0db2a04954192b2f3c203a37d27e364d6376f7db2f10e42d914c9054c896e649183efc00e5598ef5aa7e55bc9b71f14e4116980936753a37f12cff45dc9e4c3bbc93329c6fb26f9028e04444233c804fe157348927c982c9cb40aa168f54b33a4a3eddf1b64ca874504781ad8144914c76c3e279d6730c6ec89758cf204b087675a59fc6e2cb6e887387cce6120d9f079a4fc4b4f11cdd90d6065400b8d926c69b33d3aea9428cb6b7759f533aec5d8b7d216815d14e980e05c4005e9448ca51b3c7f8159c83cb8bfc25d53c55d0456386ef1adb52022f76869784dfac5692d5a2e3ebbefbc46e6f12890aa700222ab8f5af2afcfdf91791bfcd49472b305692e4785ea0652af0aa6ac28964fe17340a724aa5b52c009d38eed03000aac17168d2debcd39b49c8c1b6a20ce7dfc6db110b',
    '000000ca00c600110007efcdf10000000ac84b50dba80ad465fbfa9dfd26931cd5f84b4e038b511cee54debd8364abd8bde681a770cf2beb55239a7bede6548c5e21c8c9687241ee5d88e05a5a94bc90e16b5963c142285b00c00357458990fc9959d81ac9db0cb5e8555c9352ff444aea8b973863ae382d8cf67b712c879945195bb02fcedfdabbfe05952821eb087874c59a486ff50b792071011e5090e241f4bf5418897b6374452b391110b3b36ffd2dd9382c14cc22ea5ca5ae5cd04dbc2be3799417cb7d688b66',
    '000000cd00c900110008260b940000000c0468517586ca589aa3191c1f6f9ccfde724cf979997c1ecbad43530ce38ceb0895314be3967000bfd6c51b51aec054db26453b68b4a66d9ea282d948f8d58be92b58bee30b900cf2a61588ef47ae5adf8eb2d65a736b59f4aa15a9980cf102dddb4f389c10932daee2fc5ac2aaf5cda6e9cfac0c463291c6a677c950f1a17aa636449532c1d183fda3abd0b8d3374672459fa70f3c6a0f7f3c235826187e9ab7fb936c4b8b291264f3562243f4338890dd7772301cc96fa848691f02'
];

function _sendDummyFullBasicInfoPacket(user, dummy, objectId) {
    objectId = objectId || 96;
    var packetGuard = _makePacketGuard(0, 2);
    try {
        _putCapturedOps(packetGuard, _capturedFullBasicInfoOps, {
            2: 'S:' + objectId,
            3: 'I:' + (dummy.charac_no || 12),
            6: 'B:' + Math.max(1, Math.min(95, dummy.lev || 70)),
            88: 'I:' + (dummy.grow_type || 9),
            93: 'B:' + (dummy.area || 3)
        });
        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy full B0 basic info 0:2 packet sent object_id=' + objectId +
            ' charac_no=' + dummy.charac_no + ' area=' + dummy.area);
        return true;
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendCapturedLifecycle561Packet(user, hex, index) {
    var packetGuard = _makePacketGuard(0, 561);
    try {
        _putHexBinary(packetGuard, hex);
        InterfacePacketBuf_Finalize(packetGuard, 0);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy lifecycle captured 0:561 packet sent index=' + index +
            ' bytes=' + (hex.length / 2));
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendDummyCapturedLifecyclePacket(user, dummy, objectId) {
    objectId = objectId || 98;
    for (var i = 0; i < _capturedLifecycle561Hex.length; i++) {
        _sendCapturedLifecycle561Packet(user, _capturedLifecycle561Hex[i], i + 1);
    }

    var packetGuard = _makePacketGuard(0, 2);
    try {
        _putCapturedOps(packetGuard, _capturedLifecycleB0Ops, {
            2: 'S:' + objectId
        });
        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy lifecycle B0 0:2 packet sent object_id=' + objectId +
            ' source_charac=12 area=' + dummy.area);
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }

    _sendDummyEntityEnterPacket(user, dummy, objectId);
}

function _sendDummyCapturedSnapshotPacket(user, dummy, objectId) {
    objectId = objectId || 86;
    var packetGuard = _makePacketGuard(0, 2);
    try {
        _putCapturedOps(packetGuard, _capturedTownSnapshotOps, {
            2: 'S:' + objectId
        });
        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy captured B1 snapshot 0:2 packet sent object_id=' + objectId +
            ' source_charac=12 area=' + dummy.area);
        return true;
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

var _capturedGetUserInfoDetailOps =
    'B:2|B:18|B:18|B:2|I:5425|S:0|S:0|I:12|STR:12:给你一枪|B:0|B:5|B:18|B:70|B:0|B:0|B:0|B:0|I:1600118|I:4|B:0|I:1600118|I:0|B:1|I:632360069|I:4|B:0|I:632360069|I:0|B:2|I:1620088|I:4|B:0|I:1620088|I:0|B:3|I:632300102|I:4|B:0|I:632300102|I:0|B:4|I:632310079|I:4|B:0|I:632310079|I:0|B:5|I:1670097|I:4|B:0|I:1670097|I:0|B:6|I:1630103|I:4|B:0|I:1630103|I:0|B:7|I:632330048|I:4|B:0|I:632330048|I:0|B:8|I:612380010|I:4|B:0|I:0|I:0|B:10|I:104040021|I:4|B:1|I:0|I:2682757|B:11|I:2747351|I:4|B:0|I:0|I:0|B:0|B:0|I:0|B:0|B:1|I:0|B:3|B:0|B:0|I:0|S:1|I:6|STR:6:鬼鬼|B:0|B:0|B:0|B:1|B:0|B:0|B:0|B:10|I:27600|I:4|B:0|I:0|I:0|B:0|B:0|I:0|B:0|B:1|I:0|B:3|B:0|B:0|I:0';

function _sendDummyCapturedDetailPacket(user, dummy, objectId) {
    objectId = objectId || 92;
    var packetGuard = _makePacketGuard(0, 2);
    try {
        // Captured from GameWorld::get_user_info. It is a shorter B:2 detail response
        // and intentionally does not replace fields yet; this tests whether B:2 enriches
        // an already-created B:0 projected object.
        _putCapturedOps(packetGuard, _capturedGetUserInfoDetailOps, null);
        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy captured get_user_info B2 detail 0:2 packet sent object_id=' + objectId +
            ' source_charac=12 area=' + dummy.area);
        return true;
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendDummyTemplateAppearancePacket(user, dummy, objectId) {
    objectId = objectId || 42;
    var packetGuard = _makePacketGuard(0, 2);
    try {
        // Captured from a dressed town player. This is a protocol tracer bullet:
        // prove the appearance segment lives in 0:2 before replacing literals with DB reads.
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, 1);
        InterfacePacketBuf_Put_Short(packetGuard, objectId);
        InterfacePacketBuf_Put_Int(packetGuard, dummy.charac_no || 12);
        InterfacePacketBuf_Put_Byte(packetGuard, 5);
        InterfacePacketBuf_Put_Byte(packetGuard, 18);
        InterfacePacketBuf_Put_Byte(packetGuard, Math.max(1, Math.min(95, dummy.lev || 70)));
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);

        var equipOps = [
            [1690008, 4, 0, 1600118, 0],
            [1690009, 4, 0, 632360069, 0],
            [1690010, 4, 0, 1620088, 0],
            [1690012, 4, 0, 632300102, 0],
            [1690013, 4, 0, 632310079, 0],
            [1690015, 4, 0, 1670097, 0],
            [1690011, 4, 0, 1630103, 0],
            [1690014, 4, 0, 632330048, 0],
            [612380010, 4, 0, 0, 0]
        ];
        for (var i = 0; i < equipOps.length; i++) {
            InterfacePacketBuf_Put_Byte(packetGuard, i < 8 ? i : 8);
            InterfacePacketBuf_Put_Int(packetGuard, equipOps[i][0]);
            InterfacePacketBuf_Put_Int(packetGuard, equipOps[i][1]);
            InterfacePacketBuf_Put_Byte(packetGuard, equipOps[i][2]);
            InterfacePacketBuf_Put_Int(packetGuard, equipOps[i][3]);
            InterfacePacketBuf_Put_Int(packetGuard, equipOps[i][4]);
        }

        InterfacePacketBuf_Put_Byte(packetGuard, 10);
        InterfacePacketBuf_Put_Int(packetGuard, 104040021);
        InterfacePacketBuf_Put_Int(packetGuard, 4);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 2682757);

        InterfacePacketBuf_Put_Byte(packetGuard, 11);
        InterfacePacketBuf_Put_Int(packetGuard, 2747351);
        InterfacePacketBuf_Put_Int(packetGuard, 4);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);

        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 1);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 63201);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 11);
        InterfacePacketBuf_Put_Int(packetGuard, dummy.grow_type || 9);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, dummy.area || 3);
        InterfacePacketBuf_Put_Int(packetGuard, 11);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 3);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Int(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 100);
        InterfacePacketBuf_Put_Short(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 255);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);

        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy template appearance 0:2 packet sent object_id=' + objectId +
            ' charac_no=' + dummy.charac_no + ' area=' + dummy.area);
        return true;
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _makePacketGuard(channel, header) {
    var packetGuard = api_PacketGuard_PacketGuard();
    InterfacePacketBuf_Put_Header(packetGuard, channel, header);
    return packetGuard;
}

function _sendDummyEntityEnterPacket(user, dummy, objectId) {
    var packetGuard = _makePacketGuard(0, 23);
    try {
        InterfacePacketBuf_Put_Short(packetGuard, objectId);
        InterfacePacketBuf_Put_Byte(packetGuard, 2);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, dummy.x || 1200);
        InterfacePacketBuf_Put_Short(packetGuard, dummy.y || 250);
        InterfacePacketBuf_Put_Byte(packetGuard, dummy.area || 5);
        InterfacePacketBuf_Put_Byte(packetGuard, 3);
        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy entity enter packet sent object_id=' + objectId +
            ' charac_no=' + dummy.charac_no + ' area=' + dummy.area + ' x=' + dummy.x + ' y=' + dummy.y);
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendDummyEntitySeedPacket(user, objectId) {
    var packetGuard = _makePacketGuard(0, 339);
    try {
        InterfacePacketBuf_Put_Short(packetGuard, objectId);
        InterfacePacketBuf_Put_Byte(packetGuard, 1);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 2);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Byte(packetGuard, 3);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy entity seed packet sent object_id=' + objectId);
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendDummyEntitySnapshotPacket(user, dummy, objectId) {
    var packetGuard = _makePacketGuard(0, 24);
    try {
        InterfacePacketBuf_Put_Byte(packetGuard, 2);
        InterfacePacketBuf_Put_Byte(packetGuard, 0);
        InterfacePacketBuf_Put_Short(packetGuard, 1);
        InterfacePacketBuf_Put_Short(packetGuard, objectId);
        InterfacePacketBuf_Put_Short(packetGuard, dummy.x || 1200);
        InterfacePacketBuf_Put_Short(packetGuard, dummy.y || 250);
        InterfacePacketBuf_Put_Byte(packetGuard, dummy.area || 5);
        InterfacePacketBuf_Put_Byte(packetGuard, 3);
        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy entity snapshot packet sent object_id=' + objectId +
            ' charac_no=' + dummy.charac_no);
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendDummyEntityMovePacket(user, dummy, objectId, x, y, area) {
    var packetGuard = _makePacketGuard(0, 22);
    try {
        InterfacePacketBuf_Put_Short(packetGuard, objectId);
        InterfacePacketBuf_Put_Short(packetGuard, x);
        InterfacePacketBuf_Put_Short(packetGuard, y);
        InterfacePacketBuf_Put_Byte(packetGuard, area);
        InterfacePacketBuf_Put_Short(packetGuard, 245);
        InterfacePacketBuf_Finalize(packetGuard, 1);
        CUser_Send(user, packetGuard);
        log(INFO, '[auction-bot] dummy entity move packet sent object_id=' + objectId +
            ' x=' + x + ' y=' + y + ' area=' + area);
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendDummyTownComboTestPacket(user, dummy, objectId) {
    objectId = objectId || 11;
    var x = dummy.x || 1200;
    var y = dummy.y || 250;
    var area = dummy.area || 5;

    _sendDummyTownListTestPacket(user, dummy);
    _sendDummyEntityEnterPacket(user, dummy, objectId);
    _sendDummyEntitySnapshotPacket(user, dummy, objectId);
    _sendDummyEntityMovePacket(user, dummy, objectId, x, y, area);
    _sendDummyEntityMovePacket(user, dummy, objectId, x + 24, y, area);
    log(INFO, '[auction-bot] dummy town combo test packets sent charac_no=' + dummy.charac_no +
        ' object_id=' + objectId + ' area=' + area + ' x=' + x + ' y=' + y);
}

function _sendDummyTownSpawnTestPacket(user, dummy, objectId) {
    objectId = objectId || 11;
    var x = dummy.x || 1200;
    var y = dummy.y || 250;
    var area = dummy.area || 5;

    _sendDummyTownListTestPacket(user, dummy);
    _sendDummyEntitySeedPacket(user, objectId);
    _sendDummyEntityEnterPacket(user, dummy, objectId);
    _sendDummyEntitySnapshotPacket(user, dummy, objectId);
    log(INFO, '[auction-bot] dummy town spawn test packets sent charac_no=' + dummy.charac_no +
        ' object_id=' + objectId + ' area=' + area + ' x=' + x + ' y=' + y);
}

function _pickProjectedDummyForTest(user) {
    var currentCharacNo = CUserCharacInfo_GetCurCharacNo(user);
    var rows = auction.getProjectedBotCharacters(50);
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].charac_no !== currentCharacNo && _config.gmAuth.indexOf(rows[i].charac_no) < 0) {
            return rows[i];
        }
    }
    return null;
}

function _placeDummyNearUser(user, dummy) {
    var pos = getUserPosition(user);
    if (!pos) return dummy;
    dummy.village = pos.village || dummy.village;
    dummy.area = pos.area || dummy.area;
    dummy.x = (pos.x || dummy.x || 900) + 80;
    dummy.y = pos.y || dummy.y || 300;
    return dummy;
}

function _sendArmedDummyProjectionTest(user) {
    var armed = auction.getBotConfig('dummy_projection_test_armed');
    if (armed !== '1') {
        log(INFO, '[auction-bot] armed dummy projection skipped: not armed');
        return;
    }
    var characNo = CUserCharacInfo_GetCurCharacNo(user);
    if (_config.gmAuth.indexOf(characNo) < 0) {
        log(INFO, '[auction-bot] armed dummy projection skipped: charac_no=' + characNo + ' not gm');
        return;
    }

    auction.setBotConfig('dummy_projection_test_armed', '0', '一次性进入世界站街投影测试开关');
    var dummy = _pickProjectedDummyForTest(user);
    if (!dummy) {
        api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
        return;
    }
    dummy = _placeDummyNearUser(user, dummy);
    try {
        _sendDummyTownListTestPacket(user, dummy);
        api_CUser_SendNotiPacketMessage(user,
            '已在进入世界窗口下发1个站街测试包: ' + dummy.charac_name + '#' + dummy.charac_no, 1);
    } catch (e) {
        log(ERROR, '[auction-bot] armed dummy projection test failed: ' + (e && e.stack ? e.stack : e));
        api_CUser_SendNotiPacketMessage(user, '进入世界站街测试包发送失败，请看frida日志', 8);
    }
}

////////////////////////////////////////////////////////////////////////
// 引擎 - 狙击
////////////////////////////////////////////////////////////////////////

var _sniper = {
    enabled: false,
    interval: 30,
    lastRun: 0,

    tick: function () {
        if (_shouldSkipCycle()) return;

        var whitelist = _getMarketItems(200, false);
        if (whitelist.length === 0) return;

        var seller = auction.getSystemSeller();
        if (!seller) {
            log(WARN, '[auction-bot] 狙击引擎：未配置系统卖家');
            return;
        }

        var auctionDb = auction.getAuctionDb();
        if (!auctionDb) return;

        // 查询低于系统价的玩家物品
        var ratio = _config.snipingPriceRatio;
        var maxSnipes = Math.floor(_config.maxSnipesPerCycle * _activityMultiplier());

        // 逐个检查白名单物品
        var sniped = 0;
        for (var w = 0; w < whitelist.length && sniped < maxSnipes; w++) {
            var wl = whitelist[w];

            var sql = "SELECT a.auction_id, a.owner_id, a.item_id, COALESCE(NULLIF(a.instant_price, -1), a.unit_price) AS sell_price " +
                "FROM auction_main a WHERE a.owner_type = 0 AND a.item_id = " + wl.item_id +
                " AND a.unit_price < " + Math.floor(wl.system_price * ratio) +
                " AND a.occ_time < DATE_SUB(NOW(), INTERVAL 10 MINUTE)" +
                " AND a.expire_time > UNIX_TIMESTAMP() LIMIT " + (maxSnipes - sniped);

            if (!auction.execSql(auctionDb, sql)) continue;

            var rows = [];

            var n = auction.getNumRows(auctionDb);
            for (var i = 0; i < n; i++) {
                if (auction.fetchRow(auctionDb) != 1) break;
                var aid = auction.getIntField(auctionDb, 0);
                var oid = auction.getIntField(auctionDb, 1);
                var iid = auction.getIntField(auctionDb, 2);
                var price = auction.getIntField(auctionDb, 3);
                if (aid && oid && iid && price) {
                    rows.push({ auction_id: aid, owner_id: oid, item_id: iid, sell_price: price });
                }
            }

            for (var r = 0; r < rows.length; r++) {
                var row = rows[r];
                var success = auction.buyAuctionItem(row.auction_id, row.owner_id, row.sell_price, row.item_id, wl.cname);
                if (success) {
                    auction.logOperation('snipe', row.item_id, row.auction_id, row.owner_id, seller.owner_id, row.sell_price, 1,
                        '狙击收购: ' + (wl.cname || row.item_id) + ' @ ' + row.sell_price);
                    auction.logEconomyEvent({
                        event_type: 'snipe',
                        source: 'plugin',
                        auction_id: row.auction_id,
                        actor_type: 'system',
                        actor_id: seller.owner_id,
                        counterparty_type: 'player',
                        counterparty_id: row.owner_id,
                        item_id: row.item_id,
                        quantity: 1,
                        unit_price: row.sell_price,
                        total_price: row.sell_price,
                        gold_delta: row.sell_price,
                        item_delta: 1,
                        reason: '系统兜底低价扫货'
                    });
                    sniped++;
                }
            }
        }

        if (sniped > 0) {
            log(INFO, '[auction-bot] 狙击引擎：本轮收购 ' + sniped + ' 件');
        }
    }
};

////////////////////////////////////////////////////////////////////////
// 引擎 - 补货
////////////////////////////////////////////////////////////////////////

var _restocker = {
    enabled: false,
    interval: 300,
    lastRun: 0,

    tick: function () {
        if (_shouldSkipCycle()) return;

        var whitelist = _getMarketItems(300, false);
        if (whitelist.length === 0) return;

        var botChars = auction.getActiveBotCharacters('seller');
        if (botChars.length === 0) {
            log(WARN, '[auction-bot] 补货引擎：没有可用的卖家假人，跳过补货');
            return;
        }

        var maxRestocks = Math.floor(_config.maxRestocksPerCycle * _activityMultiplier());
        var totalRestocked = 0;

        for (var w = 0; w < whitelist.length && totalRestocked < maxRestocks; w++) {
            var wl = whitelist[w];
            var stackSize = wl.stack_size || 1;
            var targetRecords = wl.max_listings || Math.ceil(wl.quantity / stackSize);
            var targetQuantity = wl.min_total_quantity || wl.quantity || stackSize;

            // 查询当前 bot 在售数量。拍卖服务启动注册不接受 owner_type=1/owner_id=0 的系统补货行。
            var auctionDb = auction.getAuctionDb();
            if (!auctionDb) continue;

            var sql = "SELECT COUNT(*), COALESCE(SUM(add_info),0) FROM auction_main WHERE item_id = " + wl.item_id + " AND owner_type = 0 AND expire_time > UNIX_TIMESTAMP()";
            if (!auction.execSql(auctionDb, sql)) continue;


            var current = 0;
            var currentQty = 0;
            if (auction.getNumRows(auctionDb) > 0 && auction.fetchRow(auctionDb) == 1) {
                current = auction.getIntField(auctionDb, 0) || 0;
                currentQty = auction.getIntField(auctionDb, 1) || 0;
            }

            var needByRecords = Math.max(0, targetRecords - current);
            var needByQty = currentQty < targetQuantity ? Math.ceil((targetQuantity - currentQty) / Math.max(1, stackSize)) : 0;
            var need = Math.max(needByRecords, needByQty);
            need = Math.min(need, maxRestocks - totalRestocked);

            for (var i = 0; i < need; i++) {
                var owner = _makeRestockOwner(wl.item_id, current + i + 1);
                var pos = current + i;
                var addInfo = _pickListingQuantity(wl);
                if (pos >= targetRecords - 1) {
                    // 最后一条可能不满堆
                    addInfo = Math.max(1, Math.min(100, wl.quantity - (targetRecords - 1) * stackSize));
                    if ((wl.preferred_stack_max || wl.stack_size || 1) >= 100) addInfo = 100;
                }

                var basePrice = auction.calculateMarketPrice(wl.system_price, wl.item_id);
                var unitPrice = Math.floor(basePrice * _config.listingProfitMargin);
                unitPrice = _randomizePrice(unitPrice);

                var listing = {
                    owner_id: owner.owner_id,
                    owner_name: owner.owner_name,
                    owner_type: owner.owner_type,
                    owner_nexon_id: owner.owner_nexon_id,
                    item_id: wl.item_id,
                    unit_price: unitPrice,
                    add_info: addInfo,
                    upgrade: wl.upgrade || 0,
                    endurance: wl.endurance != null ? wl.endurance : 35,
                    seal_flag: wl.seal_flag != null ? wl.seal_flag : 1
                };

                if (auction.listAuctionItem(listing)) {
                    auction.logOperation('restock', wl.item_id, 0, owner.owner_id, 0, unitPrice, addInfo,
                        '假人补货: ' + owner.owner_name + '#' + owner.owner_id + ' - ' + (wl.cname || wl.item_id) + ' x' + addInfo + ' @ ' + unitPrice);
                    auction.logEconomyEvent({
                        event_type: 'restock',
                        source: 'plugin',
                        actor_type: 'bot',
                        actor_id: owner.owner_id,
                        counterparty_type: 'market',
                        counterparty_id: 0,
                        item_id: wl.item_id,
                        quantity: addInfo,
                        unit_price: unitPrice,
                        total_price: unitPrice * addInfo,
                        gold_delta: 0,
                        item_delta: addInfo,
                        reason: '假人补货'
                    });
                    totalRestocked++;
                }
            }
        }

        if (totalRestocked > 0) {
            log(INFO, '[auction-bot] 补货引擎：本轮补货 ' + totalRestocked + ' 件');
        }
    }
};

////////////////////////////////////////////////////////////////////////
// 引擎 - 上架（假人）
////////////////////////////////////////////////////////////////////////

var _lister = {
    enabled: false,
    interval: 120,
    lastRun: 0,

    tick: function () {
        if (_shouldSkipCycle()) return;

        // 重置每日计数
        auction.resetDailyCountersIfNeeded();

        var whitelist = _getMarketItems(300, true);
        if (whitelist.length === 0) return;

        var botChars = auction.getActiveBotCharacters('seller');
        if (botChars.length === 0) return;

        var maxListings = Math.floor(_config.maxListingsPerCycle * _activityMultiplier());
        var listed = 0;

        // 随机打乱假人顺序
        for (var i = botChars.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = botChars[i];
            botChars[i] = botChars[j];
            botChars[j] = tmp;
        }

        for (var c = 0; c < botChars.length && listed < maxListings; c++) {
            var ch = botChars[c];

            // 检查今日上架限额
            if (ch.listings_today >= ch.max_listings_per_day) continue;

            // 随机选物品
            var wl = whitelist[Math.floor(Math.random() * whitelist.length)];

            // 计算价格：系统价 * 假人利润率 * 市场系数
            var marketPrice = auction.calculateMarketPrice(wl.system_price, wl.item_id);
            var marginMin = ch.min_price_margin || 1.1;
            var marginMax = ch.max_price_margin || 1.8;
            var margin = marginMin + Math.random() * (marginMax - marginMin);
            var unitPrice = Math.floor(marketPrice * margin);
            unitPrice = _randomizePrice(unitPrice);

            // 随机数量
            var qty = 1;
            if (wl.stack_size > 1) {
                qty = 1 + Math.floor(Math.random() * Math.min(3, wl.stack_size));
            }

            var listing = {
                owner_id: ch.charac_no,
                owner_name: _getAuctionOwnerName(ch),
                owner_type: 0, // 玩家类型
                owner_nexon_id: '0',
                item_id: wl.item_id,
                unit_price: unitPrice,
                add_info: qty,
                upgrade: wl.upgrade || 0,
                endurance: wl.endurance != null ? wl.endurance : 35,
                seal_flag: wl.seal_flag != null ? wl.seal_flag : 1
            };

            if (auction.listAuctionItem(listing)) {
                auction.updateBotListingsToday(ch.charac_no, ch.listings_today + 1);
                auction.logOperation('list', wl.item_id, 0, 0, ch.charac_no, unitPrice, qty,
                    '假人上架: ' + ch.charac_name + ' - ' + (wl.cname || wl.item_id) + ' x' + qty + ' @ ' + unitPrice);
                auction.logEconomyEvent({
                    event_type: 'list',
                    source: 'plugin',
                    actor_type: 'bot',
                    actor_id: ch.charac_no,
                    counterparty_type: 'market',
                    counterparty_id: 0,
                    item_id: wl.item_id,
                    quantity: qty,
                    unit_price: unitPrice,
                    total_price: unitPrice * qty,
                    gold_delta: 0,
                    item_delta: -qty,
                    reason: '假人上架'
                });
                listed++;
            }
        }

        if (listed > 0) {
            log(INFO, '[auction-bot] 上架引擎：本轮 ' + listed + ' 个假人上架');
        }
    }
};

////////////////////////////////////////////////////////////////////////
// 引擎 - 竞价
////////////////////////////////////////////////////////////////////////

var _bidder = {
    enabled: false,
    interval: 90,
    lastRun: 0,

    tick: function () {
        if (_shouldSkipCycle()) return;

        var whitelist = _getMarketItems(200, false);
        if (whitelist.length === 0) return;

        var botChars = auction.getActiveBotCharacters('bidder');
        if (botChars.length === 0) return;

        var maxBids = Math.floor(_config.maxBidsPerCycle * _activityMultiplier());
        var bidCount = 0;

        var auctionDb = auction.getAuctionDb();
        if (!auctionDb) return;

        // 构建假人ID列表（排除假人自己的拍卖）
        var botCharacNos = [];
        for (var c = 0; c < botChars.length; c++) {
            botCharacNos.push(botChars[c].charac_no);
        }

        for (var w = 0; w < whitelist.length && bidCount < maxBids; w++) {
            var wl = whitelist[w];

            // 查询即将到期且bid_price低于unit_price的拍卖
            var sql = "SELECT auction_id, item_id, unit_price, COALESCE(price, unit_price) as bid_price, owner_id " +
                "FROM auction_main WHERE item_id = " + wl.item_id +
                " AND expire_time > UNIX_TIMESTAMP() AND expire_time < UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 2 HOUR))" +
                " AND owner_type = 0";

            // 排除假人自己的拍卖
            if (botCharacNos.length > 0) {
                sql += " AND owner_id NOT IN (" + botCharacNos.join(',') + ")";
            }

            sql += " ORDER BY (unit_price - COALESCE(price, unit_price)) DESC LIMIT " + (maxBids - bidCount);

            if (!auction.execSql(auctionDb, sql)) continue;

            var n = auction.getNumRows(auctionDb);
            for (var i = 0; i < n && bidCount < maxBids; i++) {
                if (auction.fetchRow(auctionDb) != 1) break;

                var auctionId = auction.getIntField(auctionDb, 0);
                var itemId = auction.getIntField(auctionDb, 1);
                var unitPrice = auction.getIntField(auctionDb, 2);
                var bidPrice = auction.getIntField(auctionDb, 3);
                var ownerId = auction.getIntField(auctionDb, 4);

                if (!auctionId || !unitPrice) continue;

                // 随机选一个竞价假人
                var bidder = botChars[Math.floor(Math.random() * botChars.length)];

                // 计算新出价：当前价 + 5~15%
                var increment = 1 + (0.05 + Math.random() * 0.10);
                var newBid = Math.floor((bidPrice || unitPrice) * increment);
                // 不超过一口价的95%
                var maxBid = Math.floor(unitPrice * 0.95);
                if (newBid > maxBid) continue;
                if (newBid <= bidPrice) continue;
                if (!auction.spendBotGold(bidder.charac_no, newBid, '竞价预留')) continue;

                // 更新出价
                var updateSql = "UPDATE auction_main SET price = " + newBid +
                    ", buyer_id = " + bidder.charac_no +
                    ", buyer_name = '" + (bidder.charac_name || '') + "'" +
                    " WHERE auction_id = " + auctionId;

                if (auction.execRaw(auctionDb, updateSql) == 1) {
                    auction.logOperation('bid', itemId, auctionId, ownerId, bidder.charac_no, newBid, 1,
                        '假人竞价: ' + bidder.charac_name + ' 对 #' + auctionId + ' 出价 ' + newBid);
                    auction.logEconomyEvent({
                        event_type: 'bid',
                        source: 'plugin',
                        auction_id: auctionId,
                        actor_type: 'bot',
                        actor_id: bidder.charac_no,
                        counterparty_type: 'player',
                        counterparty_id: ownerId,
                        item_id: itemId,
                        quantity: 1,
                        unit_price: newBid,
                        total_price: newBid,
                        gold_delta: -newBid,
                        item_delta: 0,
                        reason: '假人竞价预算占用'
                    });
                    bidCount++;
                } else {
                    auction.earnBotGold(bidder.charac_no, newBid, '竞价失败返还');
                }
            }
        }

        if (bidCount > 0) {
            log(INFO, '[auction-bot] 竞价引擎：本轮 ' + bidCount + ' 次竞价');
        }
    }
};

////////////////////////////////////////////////////////////////////////
// 定时器
////////////////////////////////////////////////////////////////////////

function _timerTick() {
    if (!_running) return;

    var now = api_CSystemTime_getCurSec();

    try {
        if (!_configLoaded && !_reloadConfig()) {
            api_ScheduleOnMainThread_Delay(_timerTick, [], 5000);
            return;
        }

        // 狙击引擎
        if (_engines.sniper.enabled && (now - _engines.sniper.lastRun >= _engines.sniper.interval)) {
            _engines.sniper.tick();
            _engines.sniper.lastRun = now;
        }

        // 补货引擎
        if (_engines.restocker.enabled && (now - _engines.restocker.lastRun >= _engines.restocker.interval)) {
            _engines.restocker.tick();
            _engines.restocker.lastRun = now;
        }

        // 上架引擎
        if (_engines.lister.enabled && (now - _engines.lister.lastRun >= _engines.lister.interval)) {
            _engines.lister.tick();
            _engines.lister.lastRun = now;
        }

        // 竞价引擎
        if (_engines.bidder.enabled && (now - _engines.bidder.lastRun >= _engines.bidder.interval)) {
            _engines.bidder.tick();
            _engines.bidder.lastRun = now;
        }

        // 邮件处理
        if (now - _lastMailPoll >= _config.mailPollInterval) {
            auction.processPendingMail();
            _lastMailPoll = now;
        }

        // 价格快照（每小时）
        if (now - _lastPriceSnapshot >= _config.priceSnapshotInterval) {
            var whitelist = auction.getWhitelistItems();
            for (var w = 0; w < whitelist.length; w++) {
                auction.recordPriceSnapshot(whitelist[w].item_id);
            }
            _lastPriceSnapshot = now;
        }
    } catch (e) {
        log(ERROR, '[auction-bot] 定时器错误: ' + e);
    }

    // 重新调度（10-20秒）
    var nextDelay = _config.enableBehaviorSim ? 10000 + get_rand_int(10000) : 15000;
    api_ScheduleOnMainThread_Delay(_timerTick, [], nextDelay);
}

////////////////////////////////////////////////////////////////////////
// GM命令处理
////////////////////////////////////////////////////////////////////////

function _handleAuctionGmCommand(user, msg) {
    var parts = msg.split(/\s+/);
    var cmd = parts[0];
    var sub = parts[1];
    var arg = parts[2];

    // //au status
    if (cmd === 'status' || (cmd === 'au' && sub === 'status')) {
        if (cmd === 'au') { sub = parts[2]; arg = parts[3]; }
        var statusLines = [
            '===== 拍卖行机器人状态 =====',
            '狙击引擎: ' + (_engines.sniper.enabled ? '开启' : '关闭') + ' (间隔' + _engines.sniper.interval + 's, 上次' + _engines.sniper.lastRun + ')',
            '上架引擎: ' + (_engines.lister.enabled ? '开启' : '关闭') + ' (间隔' + _engines.lister.interval + 's, 上次' + _engines.lister.lastRun + ')',
            '竞价引擎: ' + (_engines.bidder.enabled ? '开启' : '关闭') + ' (间隔' + _engines.bidder.interval + 's, 上次' + _engines.bidder.lastRun + ')',
            '补货引擎: ' + (_engines.restocker.enabled ? '开启' : '关闭') + ' (间隔' + _engines.restocker.interval + 's, 上次' + _engines.restocker.lastRun + ')',
            '行为模拟: ' + (_config.enableBehaviorSim ? '开启' : '关闭'),
            '收购比例: ' + _config.snipingPriceRatio,
            '利润比例: ' + _config.listingProfitMargin
        ];
        for (var s = 0; s < statusLines.length; s++) {
            api_CUser_SendNotiPacketMessage(user, statusLines[s], 3);
        }
        return;
    }

    // //au snip on|off|now
    if (cmd === 'snip' || (cmd === 'au' && sub === 'snip')) {
        if (cmd === 'au') { sub = parts[2]; arg = parts[3]; }
        if (sub === 'on') {
            _engines.sniper.enabled = true;
            auction.setBotConfig('sniping_enabled', '1', '狙击引擎开关');
            api_CUser_SendNotiPacketMessage(user, '狙击引擎已开启', 1);
        } else if (sub === 'off') {
            _engines.sniper.enabled = false;
            auction.setBotConfig('sniping_enabled', '0', '狙击引擎开关');
            api_CUser_SendNotiPacketMessage(user, '狙击引擎已关闭', 8);
        } else if (sub === 'now') {
            api_CUser_SendNotiPacketMessage(user, '正在执行狙击扫描...', 3);
            _engines.sniper.tick();
            api_CUser_SendNotiPacketMessage(user, '狙击扫描完成', 1);
        }
        return;
    }

    // //au list on|off|now
    if (cmd === 'list' || (cmd === 'au' && sub === 'list')) {
        if (cmd === 'au') { sub = parts[2]; arg = parts[3]; }
        if (sub === 'on') {
            _engines.lister.enabled = true;
            auction.setBotConfig('listing_enabled', '1', '上架引擎开关');
            api_CUser_SendNotiPacketMessage(user, '上架引擎已开启', 1);
        } else if (sub === 'off') {
            _engines.lister.enabled = false;
            auction.setBotConfig('listing_enabled', '0', '上架引擎开关');
            api_CUser_SendNotiPacketMessage(user, '上架引擎已关闭', 8);
        } else if (sub === 'now') {
            api_CUser_SendNotiPacketMessage(user, '正在执行假人上架...', 3);
            _engines.lister.tick();
            api_CUser_SendNotiPacketMessage(user, '假人上架完成', 1);
        }
        return;
    }

    // //au bid on|off|now
    if (cmd === 'bid' || (cmd === 'au' && sub === 'bid')) {
        if (cmd === 'au') { sub = parts[2]; arg = parts[3]; }
        if (sub === 'on') {
            _engines.bidder.enabled = true;
            auction.setBotConfig('bidding_enabled', '1', '竞价引擎开关');
            api_CUser_SendNotiPacketMessage(user, '竞价引擎已开启', 1);
        } else if (sub === 'off') {
            _engines.bidder.enabled = false;
            auction.setBotConfig('bidding_enabled', '0', '竞价引擎开关');
            api_CUser_SendNotiPacketMessage(user, '竞价引擎已关闭', 8);
        } else if (sub === 'now') {
            api_CUser_SendNotiPacketMessage(user, '正在执行竞价扫描...', 3);
            _engines.bidder.tick();
            api_CUser_SendNotiPacketMessage(user, '竞价扫描完成', 1);
        }
        return;
    }

    // //au restock on|off|now
    if (cmd === 'restock' || (cmd === 'au' && sub === 'restock')) {
        if (cmd === 'au') { sub = parts[2]; arg = parts[3]; }
        if (sub === 'on') {
            _engines.restocker.enabled = true;
            auction.setBotConfig('restocking_enabled', '1', '补货引擎开关');
            api_CUser_SendNotiPacketMessage(user, '补货引擎已开启（假人卖家模式）', 1);
        } else if (sub === 'off') {
            _engines.restocker.enabled = false;
            auction.setBotConfig('restocking_enabled', '0', '补货引擎开关');
            api_CUser_SendNotiPacketMessage(user, '补货引擎已关闭', 8);
        } else if (sub === 'now') {
            api_CUser_SendNotiPacketMessage(user, '正在执行单次假人补货...', 3);
            _engines.restocker.tick();
            api_CUser_SendNotiPacketMessage(user, '单次假人补货完成；如需立即刷新拍卖行索引，请重启拍卖服务', 1);
        }
        return;
    }

    // //au config <key> [value]
    if (cmd === 'config' || (cmd === 'au' && sub === 'config')) {
        if (cmd === 'au') { sub = parts[2]; arg = parts[3]; }
        if (!sub) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au config <key> [value]', 8);
            return;
        }
        if (arg !== undefined) {
            // 设置
            auction.setBotConfig(sub, arg);
            _reloadConfig();
            api_CUser_SendNotiPacketMessage(user, '配置 ' + sub + ' = ' + arg + ' 已更新', 1);
        } else {
            // 读取
            var val = auction.getBotConfig(sub);
            if (val !== null) {
                api_CUser_SendNotiPacketMessage(user, sub + ' = ' + val, 3);
            } else {
                api_CUser_SendNotiPacketMessage(user, '配置键 ' + sub + ' 不存在', 8);
            }
        }
        return;
    }

    // //au chars
    if (cmd === 'chars' || (cmd === 'au' && sub === 'chars')) {
        var chars = auction.getActiveBotCharacters(null);
        if (chars.length === 0) {
            api_CUser_SendNotiPacketMessage(user, '没有活跃的假人角色', 8);
            return;
        }
        api_CUser_SendNotiPacketMessage(user, '===== 假人角色列表 (' + chars.length + '个) =====', 3);
        for (var c = 0; c < Math.min(chars.length, 15); c++) {
            var ch = chars[c];
            api_CUser_SendNotiPacketMessage(user,
                ch.charac_name + ' | 角色: ' + ch.role + ' | 今日: ' + ch.listings_today + '/' + ch.max_listings_per_day +
                ' | 利润率: ' + ch.min_price_margin + '-' + ch.max_price_margin, 3);
        }
        if (chars.length > 15) {
            api_CUser_SendNotiPacketMessage(user, '... 还有 ' + (chars.length - 15) + ' 个角色', 3);
        }
        return;
    }

    // //au dummy ...
    if (cmd === 'dummy' || (cmd === 'au' && sub === 'dummy')) {
        var action = cmd === 'au' ? parts[3] : sub;
        var action2 = cmd === 'au' ? parts[4] : parts[2];
        var action3 = cmd === 'au' ? parts[5] : parts[3];

        if (action === 'import' && action2 === 'robots') {
            var importLimit = parseInt(action3, 10) || 500;
            var imported = auction.importRobotAccounts(importLimit, 'seller');
            api_CUser_SendNotiPacketMessage(user,
                '假人导入完成: 扫描 ' + imported.scanned + '，导入/激活 ' + imported.imported +
                '。来源: d_taiwan.accounts.isRobot=1', 1);
            return;
        }

        if (action === 'zones') {
            var zoneCount = auction.getSpawnZoneCount();
            api_CUser_SendNotiPacketMessage(user,
                '站街区域: total=' + zoneCount.total + ' enabled=' + zoneCount.enabled +
                '。请使用 tools/import-dummy-map.ps1 从 地图.json 生成SQL后导入。', 3);
            var zones = auction.getSpawnZones(true);
            for (var zi = 0; zi < Math.min(zones.length, 8); zi++) {
                var z = zones[zi];
                api_CUser_SendNotiPacketMessage(user,
                    z.name + ' vill=' + z.village + ' area=' + z.area + ' lv>=' + z.min_level +
                    ' x=' + z.x_min + '-' + z.x_max + ' y=' + z.y_min + '-' + z.y_max, 3);
            }
            if (zones.length > 8) {
                api_CUser_SendNotiPacketMessage(user, '... 还有 ' + (zones.length - 8) + ' 个启用区域', 3);
            }
            return;
        }

        if (action === 'assign') {
            var assignLimit = parseInt(action2, 10) || 500;
            var assigned = auction.assignProjectedBotLocations(assignLimit);
            api_CUser_SendNotiPacketMessage(user,
                '站街分配完成: candidates=' + assigned.candidates + ' assigned=' + assigned.assigned +
                ' zones=' + assigned.zones, assigned.assigned > 0 ? 1 : 8);
            return;
        }

        if (action === 'projected') {
            var projected = auction.getProjectedBotCharacters(parseInt(action2, 10) || 20);
            if (projected.length === 0) {
                api_CUser_SendNotiPacketMessage(user, '暂无已分配的投影假人，请先 //au dummy assign 500', 8);
                return;
            }
            api_CUser_SendNotiPacketMessage(user, '===== 投影假人预览 (' + projected.length + ') =====', 3);
            for (var pi = 0; pi < Math.min(projected.length, 12); pi++) {
                var p = projected[pi];
                api_CUser_SendNotiPacketMessage(user,
                    p.charac_name + '#' + p.charac_no + ' vill=' + p.village + ' area=' + p.area +
                    ' x=' + p.x + ' y=' + p.y, 3);
            }
            return;
        }

        if (action === 'presence' && action2 === 'pool') {
            try {
                var poolProbe = _probeCreateAndReturnPresenceUser();
                log(INFO, '[auction-bot] presence pool probe ' + JSON.stringify(poolProbe));
                api_CUser_SendNotiPacketMessage(user,
                    'presence pool: ok=' + (poolProbe.ok ? 1 : 0) +
                    ' gm=' + poolProbe.game_manager +
                    ' user=' + poolProbe.user_ptr +
                    ' uid=' + poolProbe.uid +
                    ' acc=' + poolProbe.acc_id +
                    ' unique=' + poolProbe.unique_id +
                    (poolProbe.error ? ' err=' + poolProbe.error : ''), poolProbe.ok ? 1 : 8);
            } catch (e) {
                log(ERROR, '[auction-bot] presence pool probe failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, 'presence pool探针失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'presence' && action2 === 'db') {
            var seedCharacNo = parseInt(action3, 10) || 0;
            if (!seedCharacNo) {
                api_CUser_SendNotiPacketMessage(user, '格式: //au dummy presence db [charac_no]', 8);
                return;
            }
            var seed = auction.getPresenceCharacterSeed(seedCharacNo);
            if (!seed) seed = auction.getPresenceCharacterSeedByUid(seedCharacNo);
            if (!seed) {
                api_CUser_SendNotiPacketMessage(user, '未找到#' + seedCharacNo + ' 对应的charac_no或m_id角色记录', 8);
                return;
            }
            _sendLines(user, [
                'presence db seed:',
                '#' + seed.charac_no + ' name=' + seed.charac_name + (seed.source ? ' source=' + seed.source : ''),
                'm_id=' + seed.m_id + ' lv=' + seed.lev + ' job=' + seed.job + ' grow=' + seed.grow_type,
                'village=' + seed.village + ' expert=' + seed.expert_job + ' delete=' + seed.delete_flag,
                'create=' + seed.create_time + ' last=' + seed.last_play_time
            ], 3);
            log(INFO, '[auction-bot] presence db seed ' + JSON.stringify(seed));
            return;
        }

        if (action === 'presence' && action2 === 'columns') {
            var cols = auction.describeCharacInfoColumns(parseInt(action3, 10) || 80);
            if (!cols || cols.length === 0) {
                api_CUser_SendNotiPacketMessage(user, '未能读取charac_info字段列表', 8);
                return;
            }
            var colLines = ['charac_info columns:'];
            for (var ci = 0; ci < cols.length && ci < 30; ci++) {
                colLines.push(cols[ci].pos + ':' + cols[ci].name + ' ' + cols[ci].type);
            }
            if (cols.length > 30) colLines.push('... total=' + cols.length);
            _sendLines(user, colLines, 3);
            log(INFO, '[auction-bot] charac_info columns ' + JSON.stringify(cols));
            return;
        }

        if (action === 'presence' && action2 === 'load') {
            var loadKey = parseInt(action3, 10) || 0;
            if (!loadKey) {
                api_CUser_SendNotiPacketMessage(user, '格式: //au dummy presence load [charac_no或m_id]', 8);
                return;
            }
            var loadSeed = auction.getPresenceCharacterSeed(loadKey);
            if (!loadSeed) loadSeed = auction.getPresenceCharacterSeedByUid(loadKey);
            if (!loadSeed) {
                api_CUser_SendNotiPacketMessage(user, '未找到#' + loadKey + ' 对应的charac_no或m_id角色记录', 8);
                return;
            }
            try {
                var loadProbe = _probeLoadPresenceCharacter(loadSeed);
                log(INFO, '[auction-bot] presence load probe ' + JSON.stringify(loadProbe));
                _sendLines(user, [
                    'presence load: ok=' + (loadProbe.ok ? 1 : 0) + ' set=' + loadProbe.set_ret +
                        ' select=' + (loadProbe.select_ok ? 1 : 0) + ' basic=' + (loadProbe.basic_ok ? 1 : 0),
                    'user=' + loadProbe.user_ptr + ' acc=' + loadProbe.acc_id + ' unique=' + loadProbe.unique_id,
                    'cur=#' + loadProbe.cur_no + ' name=' + loadProbe.cur_name,
                    'lv=' + loadProbe.cur_level + ' job=' + loadProbe.cur_job + ' grow=' + loadProbe.cur_grow,
                    'visible=' + (loadProbe.visible_before ? 1 : 0) + '->' + (loadProbe.visible_after ? 1 : 0)
                ], loadProbe.ok ? 1 : 8);
            } catch (e) {
                log(ERROR, '[auction-bot] presence load probe failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, 'presence load探针失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'presence' && action2 === 'world') {
            var worldKey = parseInt(action3, 10) || 0;
            if (!worldKey) {
                api_CUser_SendNotiPacketMessage(user, '格式: //au dummy presence world [charac_no或m_id] [ttl秒默认8] [克隆外观来源charac_no]', 8);
                return;
            }
            var worldTtlSec = parseInt(parts[cmd === 'au' ? 6 : 4], 10) || 8;
            var worldTtlMs = Math.max(1, Math.min(300, worldTtlSec)) * 1000;
            var cloneInventoryCharacNo = parseInt(parts[cmd === 'au' ? 7 : 5], 10) || 0;
            var worldSeed = auction.getPresenceCharacterSeed(worldKey);
            if (!worldSeed) worldSeed = auction.getPresenceCharacterSeedByUid(worldKey);
            if (!worldSeed) {
                api_CUser_SendNotiPacketMessage(user, '未找到#' + worldKey + ' 对应的charac_no或m_id角色记录', 8);
                return;
            }
            try {
                var worldProbe = _probePresenceWorld(user, worldSeed, worldTtlMs, cloneInventoryCharacNo);
                log(INFO, '[auction-bot] presence world probe ' + JSON.stringify(worldProbe));
                _sendLines(user, [
                    'presence world: ok=' + (worldProbe.ok ? 1 : 0) + ' insert=' + (worldProbe.insert_ok ? 1 : 0) +
                        ' reach=' + (worldProbe.reach_ok ? 1 : 0) +
                        ' basic=' + (worldProbe.basic_ok ? 1 : 0) + ' sent=' + (worldProbe.sent_all_basic ? 1 : 0),
                    'user=' + worldProbe.user_ptr + ' acc=' + worldProbe.acc_id + ' unique=' + worldProbe.unique_id,
                    'source=#' + worldProbe.source_charac_no + ' world=' + worldProbe.game_world,
                    'cloneInv=#' + worldProbe.clone_inventory_charac_no +
                        ' get=' + (worldProbe.clone_inventory_ok ? 1 : 0) +
                        ' set=' + (worldProbe.set_inventory_ok ? 1 : 0),
                    'area=' + worldProbe.area + ' x=' + worldProbe.x + ' y=' + worldProbe.y,
                    'key=' + worldProbe.key + ' ttl=' + Math.floor(worldProbe.ttl_ms / 1000) + 's'
                ], worldProbe.ok ? 1 : 8);
            } catch (e) {
                log(ERROR, '[auction-bot] presence world probe failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, 'presence world探针失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'one') {
            var testDummy = _pickProjectedDummyForTest(user);
            if (!testDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            testDummy = _placeDummyNearUser(user, testDummy);
            try {
                _sendDummyTownListTestPacket(user, testDummy);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发1个站街测试包: ' + testDummy.charac_name + '#' + testDummy.charac_no +
                    ' vill=' + testDummy.village + ' area=' + testDummy.area +
                    ' x=' + testDummy.x + ' y=' + testDummy.y, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test one failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '站街测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'combo') {
            if (!_getConfigBool('dummy_projection_allow_object_tests', false)) {
                api_CUser_SendNotiPacketMessage(user, 'objectId测试已默认禁用，避免误移动真实角色。需要继续请先 //au config dummy_projection_allow_object_tests 1', 8);
                return;
            }
            var comboObjectId = parseInt(action3, 10) || 11;
            var comboDummy = _pickProjectedDummyForTest(user);
            if (!comboDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            comboDummy = _placeDummyNearUser(user, comboDummy);
            try {
                _sendDummyTownComboTestPacket(user, comboDummy, comboObjectId);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发站街组合测试包: ' + comboDummy.charac_name + '#' + comboDummy.charac_no +
                    ' object=' + comboObjectId + ' area=' + comboDummy.area + ' x=' + comboDummy.x + ' y=' + comboDummy.y, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test combo failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '站街组合测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'spawn') {
            if (!_getConfigBool('dummy_projection_allow_object_tests', false)) {
                api_CUser_SendNotiPacketMessage(user, 'objectId测试已默认禁用，避免误移动真实角色。需要继续请先 //au config dummy_projection_allow_object_tests 1', 8);
                return;
            }
            var spawnObjectId = parseInt(action3, 10) || 11;
            var spawnDummy = _pickProjectedDummyForTest(user);
            if (!spawnDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            spawnDummy = _placeDummyNearUser(user, spawnDummy);
            try {
                _sendDummyTownSpawnTestPacket(user, spawnDummy, spawnObjectId);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发站街生成测试包: ' + spawnDummy.charac_name + '#' + spawnDummy.charac_no +
                    ' object=' + spawnObjectId + ' area=' + spawnDummy.area + ' x=' + spawnDummy.x + ' y=' + spawnDummy.y, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test spawn failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '站街生成测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'profile') {
            var profileObjectId = parseInt(action3, 10) || 30;
            var profileDummy = _pickProjectedDummyForTest(user);
            if (!profileDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            profileDummy = _placeDummyNearUser(user, profileDummy);
            try {
                _sendDummyTownProfile70Packet(user, profileDummy, profileObjectId);
                _sendDummyTownListTestPacket(user, profileDummy);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发站街资料测试包: ' + profileDummy.charac_name + '#' + profileDummy.charac_no +
                    ' object=' + profileObjectId + ' area=' + profileDummy.area, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test profile failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '站街资料测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'basic') {
            var basicObjectId = parseInt(action3, 10) || 30;
            var basicDummy = _pickProjectedDummyForTest(user);
            if (!basicDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            basicDummy = _placeDummyNearUser(user, basicDummy);
            try {
                _sendDummyBasicInfoPacket(user, basicDummy, basicObjectId);
                _sendDummyEntityEnterPacket(user, basicDummy, basicObjectId);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发基础建模测试包: ' + basicDummy.charac_name + '#' + basicDummy.charac_no +
                    ' object=' + basicObjectId + ' area=' + basicDummy.area +
                    ' x=' + basicDummy.x + ' y=' + basicDummy.y, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test basic failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '基础建模测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'b0full') {
            if (!_getConfigBool('dummy_projection_allow_b0full_test', false)) {
                api_CUser_SendNotiPacketMessage(user,
                    '完整B0测试已禁用：上次会导致客户端掉线。需要继续请先 //au config dummy_projection_allow_b0full_test 1',
                    8);
                return;
            }
            var b0FullObjectId = parseInt(action3, 10) || 96;
            var b0FullDummy = _pickProjectedDummyForTest(user);
            if (!b0FullDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            b0FullDummy = _placeDummyNearUser(user, b0FullDummy);
            try {
                _sendDummyFullBasicInfoPacket(user, b0FullDummy, b0FullObjectId);
                _sendDummyEntityEnterPacket(user, b0FullDummy, b0FullObjectId);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发完整B0建模测试包: ' + b0FullDummy.charac_name + '#' + b0FullDummy.charac_no +
                    ' object=' + b0FullObjectId + ' area=' + b0FullDummy.area +
                    ' x=' + b0FullDummy.x + ' y=' + b0FullDummy.y, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test b0full failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '完整B0建模测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'lifecycle') {
            if (!_getConfigBool('dummy_projection_allow_lifecycle_test', false)) {
                api_CUser_SendNotiPacketMessage(user,
                    '生命周期复放测试已禁用：会复放0:561+B0。需要继续请先 //au config dummy_projection_allow_lifecycle_test 1',
                    8);
                return;
            }
            var lifecycleObjectId = parseInt(action3, 10) || 98;
            var lifecycleDummy = _pickProjectedDummyForTest(user);
            if (!lifecycleDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            lifecycleDummy = _placeDummyNearUser(user, lifecycleDummy);
            try {
                _sendDummyCapturedLifecyclePacket(user, lifecycleDummy, lifecycleObjectId);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发生命周期复放测试包: source=#12 object=' + lifecycleObjectId +
                    ' area=' + lifecycleDummy.area + ' x=' + lifecycleDummy.x + ' y=' + lifecycleDummy.y, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test lifecycle failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '生命周期复放测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'resendbasic') {
            var gameWorld = _getUserGameWorld(user);
            if (!gameWorld) {
                api_CUser_SendNotiPacketMessage(user, '当前角色还没有记录到GameWorld指针，请小退重进后再试', 8);
                return;
            }
            try {
                _GameWorld_send_AllBasicInfo(gameWorld, user);
                api_CUser_SendNotiPacketMessage(user,
                    '已调用服务端GameWorld::send_AllBasicInfo重发当前世界基础建模包 gameWorld=' + gameWorld, 1);
                log(INFO, '[auction-bot] resend GameWorld::send_AllBasicInfo user=' + user +
                    ' game_world=' + gameWorld);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test resendbasic failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '重发send_AllBasicInfo失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'selfbasic') {
            try {
                _sendRealUserBasicInfoPacket(user, user, 0);
                api_CUser_SendNotiPacketMessage(user,
                    '已用当前CUser::make_basic_info(mode0)生成并下发自己的建模包', 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test selfbasic failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, 'selfbasic发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'onlinebasic') {
            var sourceCharacNo = parseInt(action3, 10) || 0;
            var sourceMode = parseInt(parts[cmd === 'au' ? 6 : 4], 10);
            if (isNaN(sourceMode)) sourceMode = 1;
            if (!sourceCharacNo) {
                api_CUser_SendNotiPacketMessage(user, '格式: //au dummy test onlinebasic [charac_no] [mode默认1]', 8);
                return;
            }
            var sourceOnline = auction.getOnlineCharacterInfo(sourceCharacNo);
            var sourceUserPtr = sourceOnline && sourceOnline.user_ptr ? ptr(sourceOnline.user_ptr) : _getObservedUser(sourceCharacNo);
            if (!sourceUserPtr || sourceUserPtr.isNull()) {
                api_CUser_SendNotiPacketMessage(user, '源角色#' + sourceCharacNo + ' 当前未在线或未被探针观察到', 8);
                return;
            }
            try {
                var okOnline = _sendRealUserBasicInfoPacket(user, sourceUserPtr, sourceMode);
                api_CUser_SendNotiPacketMessage(user,
                    '已用在线角色#' + sourceCharacNo + ' 的CUser生成建模包 mode=' + sourceMode + ' ok=' + okOnline, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test onlinebasic failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, 'onlinebasic发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'armclone') {
            auction.setBotConfig('dummy_projection_clone_until_ms', '0', '一次性克隆建模过期时间');
            api_CUser_SendNotiPacketMessage(user,
                'armclone已禁用：真实进入世界objectId替换会导致客户端闪退，已清除武装开关', 8);
            return;
        }

        if (action === 'observed') {
            var observed = _listObservedUsers(parseInt(action2, 10) || 20);
            if (observed.length === 0) {
                api_CUser_SendNotiPacketMessage(user, '暂无已观察到的CUser，请让目标角色小退重进或进入同屏', 8);
                return;
            }
            var observedLines = ['已观察到的CUser:'];
            for (var oi = 0; oi < observed.length && oi < 20; oi++) {
                observedLines.push('#' + observed[oi].charac_no +
                    ' user=' + observed[oi].user_ptr +
                    ' reason=' + observed[oi].reason);
            }
            _sendLines(user, observedLines, 3);
            return;
        }

        if (action === 'test' && action2 === 'rich') {
            var richObjectId = parseInt(action3, 10) || 31;
            var richDummy = _pickProjectedDummyForTest(user);
            if (!richDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            richDummy = _placeDummyNearUser(user, richDummy);
            try {
                _sendDummyBasicInfoPacket(user, richDummy, richObjectId);
                _sendDummyTownProfile70Packet(user, richDummy, richObjectId);
                _sendDummyTownListTestPacket(user, richDummy);
                _sendDummyEntityEnterPacket(user, richDummy, richObjectId);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发富信息建模测试包: ' + richDummy.charac_name + '#' + richDummy.charac_no +
                    ' object=' + richObjectId + ' lv=' + (richDummy.lev || 1) +
                    ' area=' + richDummy.area, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test rich failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '富信息建模测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'dressed') {
            if (!_getConfigBool('dummy_projection_allow_dressed_test', false)) {
                api_CUser_SendNotiPacketMessage(user,
                    '模板装扮测试已禁用：上次会导致客户端掉线。需要继续请先 //au config dummy_projection_allow_dressed_test 1',
                    8);
                return;
            }
            var dressedObjectId = parseInt(action3, 10) || 42;
            var dressedDummy = _pickProjectedDummyForTest(user);
            if (!dressedDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            dressedDummy = _placeDummyNearUser(user, dressedDummy);
            try {
                _sendDummyTemplateAppearancePacket(user, dressedDummy, dressedObjectId);
                _sendDummyEntityEnterPacket(user, dressedDummy, dressedObjectId);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发模板装扮建模测试包: ' + dressedDummy.charac_name + '#' + dressedDummy.charac_no +
                    ' object=' + dressedObjectId + ' area=' + dressedDummy.area, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test dressed failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '模板装扮建模测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'captured') {
            if (!_getConfigBool('dummy_projection_allow_captured_test', false)) {
                api_CUser_SendNotiPacketMessage(user,
                    '真实抓包B1快照测试已禁用：上次会导致客户端掉线。需要继续请先 //au config dummy_projection_allow_captured_test 1',
                    8);
                return;
            }
            var capturedObjectId = parseInt(action3, 10) || 86;
            var capturedDummy = _pickProjectedDummyForTest(user);
            if (!capturedDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            capturedDummy = _placeDummyNearUser(user, capturedDummy);
            try {
                _sendDummyCapturedSnapshotPacket(user, capturedDummy, capturedObjectId);
                _sendDummyEntityEnterPacket(user, capturedDummy, capturedObjectId);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发真实抓包B1快照测试包: source=滑室驴行#12 object=' +
                    capturedObjectId + ' area=' + capturedDummy.area, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test captured failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, '真实抓包B1快照测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'detail') {
            var detailObjectId = parseInt(action3, 10) || 92;
            var detailDummy = _pickProjectedDummyForTest(user);
            if (!detailDummy) {
                api_CUser_SendNotiPacketMessage(user, '暂无可测试的投影假人，请确认候选不包含当前GM并先 //au dummy assign 500', 8);
                return;
            }
            detailDummy = _placeDummyNearUser(user, detailDummy);
            try {
                _sendDummyBasicInfoPacket(user, detailDummy, detailObjectId);
                _sendDummyCapturedDetailPacket(user, detailDummy, detailObjectId);
                _sendDummyEntityEnterPacket(user, detailDummy, detailObjectId);
                api_CUser_SendNotiPacketMessage(user,
                    '已向当前GM下发B0建模+B2详情测试包: object=' + detailObjectId +
                    ' area=' + detailDummy.area, 1);
            } catch (e) {
                log(ERROR, '[auction-bot] dummy test detail failed: ' + (e && e.stack ? e.stack : e));
                api_CUser_SendNotiPacketMessage(user, 'B2详情测试包发送失败，请看frida日志', 8);
            }
            return;
        }

        if (action === 'test' && action2 === 'arm') {
            auction.setBotConfig('dummy_projection_test_armed', '1', '一次性进入世界站街投影测试开关');
            api_CUser_SendNotiPacketMessage(user,
                '已武装进入世界站街测试：请小退重进，进入世界约1.3秒后会自动下发1个测试包', 1);
            return;
        }

        if (action === 'probe' && action2 === 'arm') {
            auction.setBotConfig('dummy_projection_probe_armed', '1', '一次性城镇同屏建模探测开关');
            api_CUser_SendNotiPacketMessage(user,
                '已武装同屏建模探测：请留在城镇，等待提示后让另一个角色小退重进或走进同屏', 1);
            _sendDummyTownListTestPacket(user, {
                charac_no: CUserCharacInfo_GetCurCharacNo(user),
                charac_name: 'probe',
                area: 0,
                x: 0,
                y: 0
            });
            return;
        }

        if (action === 'probe' && action2 === 'command') {
            auction.setBotConfig('dummy_projection_command_capture', '1', '一次性GM命令发包探测开关');
            api_CUser_SendNotiPacketMessage(user,
                '已武装GM命令发包探测：请小退重进，看到探测开始提示后立即执行目标测试命令', 1);
            return;
        }

        if (action === 'probe' && action2 === 'target') {
            var targetCharacNo = parseInt(action3, 10) || 0;
            if (!targetCharacNo) {
                api_CUser_SendNotiPacketMessage(user, '格式: //au dummy probe target [charac_no]', 8);
                return;
            }
            auction.setBotConfig('dummy_projection_probe_target_charac', '' + targetCharacNo, '城镇同屏建模探测目标角色号');
            api_CUser_SendNotiPacketMessage(user, '已设置同屏建模探测目标 charac_no=' + targetCharacNo, 1);
            return;
        }

        if (action === 'uid') {
            var uid = parseInt(action2, 10) || 0;
            if (!uid) {
                api_CUser_SendNotiPacketMessage(user, '格式: //au dummy uid [UID]', 8);
                return;
            }
            var uidRows = auction.getCharactersByUid(uid);
            if (!uidRows || uidRows.length === 0) {
                api_CUser_SendNotiPacketMessage(user, 'UID=' + uid + ' 未查到角色', 8);
                return;
            }
            var uidLines = ['UID=' + uid + ' 角色列表:'];
            for (var ui = 0; ui < uidRows.length && ui < 12; ui++) {
                var ur = uidRows[ui];
                uidLines.push(ur.charac_name + '#' + ur.charac_no +
                    ' lv=' + ur.lev + ' job=' + ur.job + ' grow=' + ur.grow_type);
            }
            _sendLines(user, uidLines, 3);
            return;
        }

        if (action === 'online') {
            var onlineCharacNo = parseInt(action2, 10) || 0;
            if (!onlineCharacNo) {
                api_CUser_SendNotiPacketMessage(user, '格式: //au dummy online [charac_no]', 8);
                return;
            }
            var onlineInfo = auction.getOnlineCharacterInfo(onlineCharacNo);
            if (!onlineInfo) {
                api_CUser_SendNotiPacketMessage(user, 'charac_no=' + onlineCharacNo + ' 当前未在线或未进入GameWorld', 8);
                return;
            }
            _sendLines(user, [
                '在线角色: #' + onlineInfo.charac_no,
                'user=' + onlineInfo.user_ptr + ' state=' + onlineInfo.state,
                'pos area=' + onlineInfo.pos.area + ' x=' + onlineInfo.pos.x + ' y=' + onlineInfo.pos.y
            ], 3);
            log(INFO, '[auction-bot] online charac probe charac_no=' + onlineInfo.charac_no +
                ' user=' + onlineInfo.user_ptr + ' state=' + onlineInfo.state +
                ' area=' + onlineInfo.pos.area + ' x=' + onlineInfo.pos.x + ' y=' + onlineInfo.pos.y);
            return;
        }

        _sendLines(user, [
            '格式:',
            '//au dummy import robots [limit] - 导入 accounts.isRobot=1 假人',
            '//au dummy zones - 查看站街区域',
            '//au dummy assign [limit] - 分配投影站街位置',
            '//au dummy projected [limit] - 预览投影假人',
            '//au dummy presence pool - 只分配并归还一个服务端CUser池对象探针',
            '//au dummy presence db [charac_no] - 读取角色Presence种子字段',
            '//au dummy presence columns [limit] - 查看charac_info字段',
            '//au dummy presence load [charac_no或m_id] - 短生命周期加载角色到CUser探针',
            '//au dummy presence world [charac_no或m_id] [ttl秒] [外观来源#] - 临时注册离线CUser进当前世界',
            '//au dummy test one - 只向当前GM下发1个站街测试包',
            '//au dummy test basic [objectId] - 下发0:2+0:23基础建模测试',
            '//au dummy test b0full [objectId] - 高风险真实抓包完整B0+0:23建模测试，默认禁用',
            '//au dummy test lifecycle [objectId] - 高风险复放0:561+B0+0:23测试，默认禁用',
            '//au dummy test resendbasic - 调用服务端send_AllBasicInfo重发当前世界建模包',
            '//au dummy test selfbasic - 调用当前CUser::make_basic_info(mode0)下发自己的建模包',
            '//au dummy test onlinebasic [charac_no] [mode] - 用在线真实角色CUser生成建模包',
            '//au dummy test armclone [charac_no] [objectId] - 已禁用，仅清除危险克隆开关',
            '//au dummy observed [limit] - 查看探针观察到的真实CUser缓存',
            '//au dummy test rich [objectId] - 下发0:2+0:70+1:70+0:23富信息测试',
            '//au dummy test dressed [objectId] - 高风险模板外观0:2+0:23测试，默认禁用',
            '//au dummy test captured [objectId] - 高风险真实抓包B1快照测试，默认禁用',
            '//au dummy test detail [objectId] - 下发B0建模+B2详情+0:23测试',
            '//au dummy test profile [objectId] - 下发0:70+1:70，不移动',
            '//au dummy test spawn [objectId] - 下发1:70+0:339+0:23/24，不移动',
            '//au dummy test combo [objectId] - 下发1:70+0:23/24/22组合测试包',
            '//au dummy test arm - 下次GM进入世界窗口自动下发1个测试包',
            '//au dummy probe arm - 捕获另一个角色进入GM同屏时的建模包',
            '//au dummy probe command - 捕获下一次GM命令主动触发的发包',
            '//au dummy probe target [charac_no] - 设置重点探测角色号',
            '//au dummy uid [UID] - 查询账号UID下的角色',
            '//au dummy online [charac_no] - 查询在线角色CUser指针和位置'
        ], 8);
        return;
    }

    // //au char add <name>
    if ((cmd === 'char' && sub === 'add') || (cmd === 'au' && sub === 'char' && parts[3] === 'add')) {
        var charName = arg;
        if (cmd === 'au') charName = parts[4];
        if (!charName) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au char add <角色名>', 8);
            return;
        }
        var charInfo = auction.getCharacByName(charName);
        if (!charInfo) {
            api_CUser_SendNotiPacketMessage(user, '未找到角色: ' + charName, 8);
            return;
        }
        var role = parts[parts.length - 1];
        if (role !== 'seller' && role !== 'bidder' && role !== 'both') role = 'seller';
        if (auction.addBotCharacter(charInfo.charac_no, charName, charInfo.m_id, role)) {
            api_CUser_SendNotiPacketMessage(user, '已添加假人: ' + charName + ' (角色: ' + role + ')', 1);
        } else {
            api_CUser_SendNotiPacketMessage(user, '添加失败，请检查日志', 8);
        }
        return;
    }

    // //au char remove <name>
    if ((cmd === 'char' && sub === 'remove') || (cmd === 'au' && sub === 'char' && parts[3] === 'remove')) {
        var charName = arg;
        if (cmd === 'au') charName = parts[4];
        if (!charName) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au char remove <角色名>', 8);
            return;
        }
        var charInfo = auction.getCharacByName(charName);
        if (!charInfo) {
            api_CUser_SendNotiPacketMessage(user, '未找到角色: ' + charName, 8);
            return;
        }
        if (auction.removeBotCharacter(charInfo.charac_no)) {
            api_CUser_SendNotiPacketMessage(user, '已移除假人: ' + charName, 1);
        } else {
            api_CUser_SendNotiPacketMessage(user, '移除失败，请检查日志', 8);
        }
        return;
    }

    // //au char role <name> <role>
    if ((cmd === 'char' && sub === 'role') || (cmd === 'au' && sub === 'char' && parts[3] === 'role')) {
        var charName = arg;
        var newRole = parts[3];
        if (cmd === 'au') { charName = parts[4]; newRole = parts[5]; }
        if (!charName || !newRole) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au char role <角色名> seller|bidder|both', 8);
            return;
        }
        var charInfo = auction.getCharacByName(charName);
        if (!charInfo) {
            api_CUser_SendNotiPacketMessage(user, '未找到角色: ' + charName, 8);
            return;
        }
        if (auction.setBotCharacterRole(charInfo.charac_no, newRole)) {
            api_CUser_SendNotiPacketMessage(user, '已更新 ' + charName + ' 角色为: ' + newRole, 1);
        } else {
            api_CUser_SendNotiPacketMessage(user, '更新失败，请检查日志', 8);
        }
        return;
    }

    // //au stats <itemId>
    if (cmd === 'stats' || (cmd === 'au' && sub === 'stats')) {
        var itemId = _parseItemIdArg(cmd === 'au' ? parts[3] : sub);
        if (!itemId) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au stats <物品ID>', 8);
            return;
        }
        var stats = auction.getAuctionStats(itemId);
        var history = auction.getPriceHistory(itemId, 24);

        if (!stats || stats.total_listings === null) {
            api_CUser_SendNotiPacketMessage(user, '物品 ' + itemId + ' 暂无在售数据', 8);
            return;
        }

        api_CUser_SendNotiPacketMessage(user, '===== 物品 ' + itemId + ' 市场统计 =====', 3);
        api_CUser_SendNotiPacketMessage(user, '在售数量: ' + stats.total_listings, 3);
        api_CUser_SendNotiPacketMessage(user, '均价: ' + stats.avg_price + ' | 最低: ' + stats.min_price + ' | 最高: ' + stats.max_price, 3);
        api_CUser_SendNotiPacketMessage(user, '总库存: ' + (stats.total_quantity || 0), 3);

        if (history.length > 0) {
            var latest = history[0];
            api_CUser_SendNotiPacketMessage(user, '最近快照 [' + latest.snapshot_time + ']: 均价 ' + latest.avg_price + ', 在售 ' + latest.total_listings, 3);
        }

        var marketPrice = auction.calculateMarketPrice(stats.avg_price || 1000, itemId);
        api_CUser_SendNotiPacketMessage(user, '市场调整价: ' + marketPrice, 1);
        return;
    }

    // //au health
    if (cmd === 'health' || (cmd === 'au' && sub === 'health')) {
        var health = auction.getEconomyHealth();
        if (!health) {
            api_CUser_SendNotiPacketMessage(user, '经济健康数据不可用', 8);
            return;
        }
        _sendLines(user, [
            '===== 拍卖行经济健康 =====',
            '今日事件: ' + health.events,
            '今日正向金币流: ' + health.injected,
            '今日金币回收/支出: ' + health.sink,
            'Bot今日花费: ' + health.bot_spent,
            'Bot今日收入: ' + health.bot_earned
        ], 3);
        return;
    }

    // //au market <itemId>
    if (cmd === 'market' || (cmd === 'au' && sub === 'market')) {
        var mid = _parseItemIdArg(cmd === 'au' ? parts[3] : sub);
        if (!mid) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au market <物品ID>', 8);
            return;
        }
        var profile = auction.getItemProfile(mid);
        var marketStats = auction.getAuctionStats(mid);
        if (!profile && !marketStats) {
            api_CUser_SendNotiPacketMessage(user, '未找到物品市场数据: ' + mid, 8);
            return;
        }
        var lines = ['===== 市场 ' + mid + ' ====='];
        if (profile) {
            lines.push('名称: ' + (profile.cname || mid) + ' | ' + profile.category + ' | Tier ' + profile.market_tier);
            lines.push('基准价: ' + profile.base_price + ' | 波动: ' + profile.volatility + ' | 来源: ' + profile.source);
            lines.push('挂单目标: ' + profile.min_listings + '-' + profile.max_listings + ' | 库存目标: ' + profile.min_total_quantity + '-' + profile.max_total_quantity);
        }
        if (marketStats) {
            lines.push('当前挂单: ' + marketStats.total_listings + ' | 总量: ' + marketStats.total_quantity);
            lines.push('均价: ' + marketStats.avg_price + ' | 最低: ' + marketStats.min_price + ' | 最高: ' + marketStats.max_price);
        }
        _sendLines(user, lines, 3);
        return;
    }

    // //au wallet <botName>
    if (cmd === 'wallet' || (cmd === 'au' && sub === 'wallet')) {
        var walletName = cmd === 'au' ? parts[3] : sub;
        if (!walletName) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au wallet <角色名>', 8);
            return;
        }
        var walletChar = auction.getCharacByName(walletName);
        if (!walletChar) {
            api_CUser_SendNotiPacketMessage(user, '未找到角色: ' + walletName, 8);
            return;
        }
        var wallet = auction.getBotWallet(walletChar.charac_no);
        if (!wallet) {
            api_CUser_SendNotiPacketMessage(user, '钱包不可用: ' + walletName, 8);
            return;
        }
        _sendLines(user, [
            '===== 钱包 ' + walletName + ' =====',
            '余额: ' + wallet.gold_balance + ' | 信用: ' + wallet.credit_limit + ' | 预留: ' + wallet.reserved_gold,
            '今日花费: ' + wallet.spent_today + '/' + wallet.daily_spend_limit,
            '今日收入: ' + wallet.earned_today + ' | 注入: ' + wallet.injected_today + ' | 回收: ' + wallet.sink_today
        ], 3);
        return;
    }

    // //au profile set <itemId> <field> <value>
    if ((cmd === 'profile' && sub === 'set') || (cmd === 'au' && sub === 'profile' && parts[3] === 'set')) {
        var pItem = cmd === 'au' ? parts[4] : parts[2];
        var pField = cmd === 'au' ? parts[5] : parts[3];
        var pValue = cmd === 'au' ? parts[6] : parts[4];
        if (!pItem || !pField || pValue === undefined) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au profile set <物品ID> <字段> <值>', 8);
            return;
        }
        if (auction.setItemProfileField(parseInt(pItem, 10), pField, pValue)) {
            api_CUser_SendNotiPacketMessage(user, 'profile 已更新: ' + pItem + ' ' + pField + '=' + pValue, 1);
        } else {
            api_CUser_SendNotiPacketMessage(user, 'profile 更新失败，字段可能不允许', 8);
        }
        return;
    }

    // //au ledger [itemId]
    if (cmd === 'ledger' || (cmd === 'au' && sub === 'ledger')) {
        var ledgerArg = _stripPlusPrefix(cmd === 'au' ? parts[3] : sub);
        var filter = {};
        if (ledgerArg) filter.item_id = parseInt(ledgerArg, 10);
        var ledger = auction.getLedgerRows(filter, 8);
        if (ledger.length === 0) {
            api_CUser_SendNotiPacketMessage(user, '暂无经济台账记录', 8);
            return;
        }
        api_CUser_SendNotiPacketMessage(user, '===== 最近经济台账 =====', 3);
        for (var li = 0; li < ledger.length; li++) {
            var lr = ledger[li];
            api_CUser_SendNotiPacketMessage(user,
                lr.created_at + ' ' + lr.event_type + ' item=' + lr.item_id + ' qty=' + lr.quantity +
                ' price=' + lr.unit_price + ' gold=' + lr.gold_delta + ' ' + (lr.reason || ''), 3);
        }
        return;
    }

    // //au import iteminfo
    if ((cmd === 'import' && sub === 'iteminfo') || (cmd === 'au' && sub === 'import' && parts[3] === 'iteminfo')) {
        auction.syncWhitelistProfiles();
        api_CUser_SendNotiPacketMessage(user, '已同步 auction_whitelist 到 auction_item_profile。全量 iteminfo.dat 请先运行 tools/import-iteminfo.ps1 生成SQL后导入。', 1);
        return;
    }

    // //au reload
    if (cmd === 'reload' || (cmd === 'au' && sub === 'reload')) {
        _reloadConfig();
        api_CUser_SendNotiPacketMessage(user, '拍卖行机器人配置已重新加载', 1);
        return;
    }

    // //au help
    if (cmd === 'help' || (cmd === 'au' && sub === 'help') || !cmd || cmd === 'au') {
        var helpLines = [
            '===== 拍卖行机器人命令 =====',
            '//au status - 查看引擎状态',
            '//au snip on|off|now - 狙击引擎控制',
            '//au list on|off|now - 上架引擎控制',
            '//au bid on|off|now - 竞价引擎控制',
            '//au restock on|off|now - 补货引擎控制',
            '//au config <key> [value] - 配置读写',
            '//au chars - 假人角色列表',
            '//au dummy import robots [limit] - 导入数据库假人',
            '//au dummy zones|assign|projected - 站街投影数据管理',
            '//au dummy presence pool - 服务端CUser池对象探针',
            '//au dummy presence db|columns|load - 服务端Presence数据探针',
            '//au char add <name> [role] - 添加假人',
            '//au char remove <name> - 移除假人',
            '//au char role <name> <role> - 设置角色',
            '//au stats <itemId> - 物品市场统计',
            '//au health - 查看经济健康',
            '//au market <itemId> - 查看市场画像',
            '//au wallet <name> - 查看Bot钱包',
            '//au profile set <itemId> <field> <value> - 修改画像',
            '//au ledger [itemId] - 查看经济台账',
            '//au import iteminfo - 同步白名单画像',
            '//au reload - 重新加载配置'
        ];
        for (var h = 0; h < helpLines.length; h++) {
            api_CUser_SendNotiPacketMessage(user, helpLines[h], 3);
        }
        return;
    }
}

////////////////////////////////////////////////////////////////////////
// 导出
////////////////////////////////////////////////////////////////////////

module.exports = {
    init() {
        log(INFO, '[auction-bot] 初始化拍卖行机器人...');

        // 初始化引擎状态
        _engines.sniper = _sniper;
        _engines.lister = _lister;
        _engines.bidder = _bidder;
        _engines.restocker = _restocker;

        // DB表由 base-auction 延迟初始化。这里不阻塞登录流程，交给首次 timer tick 再加载。
        _configLoaded = false;

        // 启动定时器
        _running = true;
        _lastMailPoll = api_CSystemTime_getCurSec();
        _lastPriceSnapshot = api_CSystemTime_getCurSec();
        _engines.sniper.lastRun = api_CSystemTime_getCurSec();
        _engines.lister.lastRun = api_CSystemTime_getCurSec();
        _engines.bidder.lastRun = api_CSystemTime_getCurSec();
        _engines.restocker.lastRun = api_CSystemTime_getCurSec();

        api_ScheduleOnMainThread_Delay(_timerTick, [], 5000);

        log(INFO, '[auction-bot] 拍卖行机器人初始化完成');
        log(INFO, '[auction-bot] 狙击=' + (_engines.sniper.enabled ? '开' : '关') +
            ' 上架=' + (_engines.lister.enabled ? '开' : '关') +
            ' 竞价=' + (_engines.bidder.enabled ? '开' : '关') +
            ' 补货=' + (_engines.restocker.enabled ? '开' : '关'));
    },

    dispose() {
        _running = false;
        log(INFO, '[auction-bot] 拍卖行机器人已停止');
    },

    hooks: [
        {
            address: '0x820BBDE',
            onEnter(args) {
                var user = args[1];
                var charac_no = CUserCharacInfo_GetCurCharacNo(user);
                if (!_config.gmAuth.includes(charac_no))
                    return;

                // 解析聊天消息
                var rawPacketBuf = api_PacketBuf_Get_Buf(args[2]);
                var msgLen = rawPacketBuf.readInt();
                var msg = rawPacketBuf.add(4).readUtf8String(msgLen);
                msg = msg.slice(2).trim();

                // 匹配 //au 或 //auction 命令
                if (msg.indexOf('au ') === 0 || msg === 'au' || msg.indexOf('auction ') === 0 || msg === 'auction') {
                    // 去掉前缀
                    var cmdPart = msg;
                    if (cmdPart.indexOf('auction ') === 0) {
                        cmdPart = cmdPart.substring(8);
                    } else if (cmdPart.indexOf('au ') === 0) {
                        cmdPart = cmdPart.substring(3);
                    } else if (cmdPart === 'au' || cmdPart === 'auction') {
                        cmdPart = 'help';
                    }
                    _handleAuctionGmCommand(user, cmdPart);
                }
            }
        },
        {
            // GameWorld::reach_game_world
            address: '0x86C4E50',
            onEnter(args) {
                this.gameWorld = args[0];
                this.user = args[1];
            },
            onLeave(retval) {
                if (this.user) {
                    _rememberObservedUser(this.user, 'reach_game_world');
                    _rememberUserGameWorld(this.user, this.gameWorld);
                    log(INFO, '[auction-bot] armed dummy projection check scheduled after reach_game_world user=' + this.user);
                    api_ScheduleOnMainThread_Delay(_sendArmedDummyProjectionTest, [this.user], 1300);
                }
            }
        },
    ]
};
