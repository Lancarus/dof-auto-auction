/**
 * base-auction.js
 * 拍卖行基础模块 - 提供数据库操作和拍卖API
 * 20260526
 */

////////////////////////////////////////////////////////////////////////
// 接口
////////////////////////////////////////////////////////////////////////

const { log } = context.main;
const { INFO, WARN, ERROR } = context.main.LOG_LEVELS;

const { api_MySQL_Exec_Safe, MySQL_Get_N_Rows, MySQL_Fetch, api_MySQL_Get_Str } = context.mysql.dbUtils;
const dbConnector = context.mysql.dbConnector;
const { gameService } = context.mysql;

const { api_CSystemTime_getCurSec, getTimestamp } = context.system.time;
const { strlen } = context.system.common;
const { api_ScheduleOnMainThread, api_ScheduleOnMainThread_Delay } = context.system.thread;

// --------------- MySQL 底层操作（补充未导出的函数）------------------

var MySQL_Get_Int = new NativeFunction(ptr(0x811692C), 'int', ['pointer', 'int', 'pointer'], { "abi": "sysv" });
var MySQL_Get_Uint = new NativeFunction(ptr(0x80E22F2), 'int', ['pointer', 'int', 'pointer'], { "abi": "sysv" });
var MySQL_Get_Ulonglong = new NativeFunction(ptr(0x81754C8), 'int', ['pointer', 'int', 'pointer'], { "abi": "sysv" });
var MySQL_set_query_4 = new NativeFunction(ptr(0x83F41C0), 'int', ['pointer', 'pointer', 'int', 'int'], { "abi": "sysv" });
var MySQL_set_query_5 = new NativeFunction(ptr(0x83F41C0), 'int', ['pointer', 'pointer', 'int', 'int', 'int'], { "abi": "sysv" });
var MySQL_Exec = new NativeFunction(ptr(0x83F4326), 'int', ['pointer', 'int'], { "abi": "sysv" });
var MySQL_Get_Binary = new NativeFunction(ptr(0x812531A), 'int', ['pointer', 'int', 'pointer', 'int'], { "abi": "sysv" });
var MySQL_Get_Binary_Length = new NativeFunction(ptr(0x81253DE), 'int', ['pointer', 'int'], { "abi": "sysv" });
var MySQL_Set_Query_3 = new NativeFunction(ptr(0x83F41C0), 'int', ['pointer', 'pointer', 'pointer'], { "abi": "sysv" });
var MySQL_Set_Query_3_Int = new NativeFunction(ptr(0x83F41C0), 'int', ['pointer', 'pointer', 'int'], { "abi": "sysv" });

// --------------- 游戏函数（邮件相关）------------------

var ReqDBSendNewSystemMail = new NativeFunction(ptr(0x085555E8), 'int', ['pointer', 'pointer', 'int', 'int', 'pointer', 'int', 'int', 'int', 'char', 'char'], { "abi": "sysv" });
var Inven_Item = new NativeFunction(ptr(0x080CB854), 'void', ['pointer'], { "abi": "sysv" });
var GetItem_index = new NativeFunction(ptr(0x08110C48), 'int', ['pointer'], { "abi": "sysv" });
var GetServerGroup = new NativeFunction(ptr(0x080CBC90), 'int', ['pointer'], { "abi": "sysv" });

// 在线玩家遍历
var G_GameWorld = new NativeFunction(ptr(0x80DA3A7), 'pointer', [], { "abi": "sysv" });
var gameworld_user_map_begin = new NativeFunction(ptr(0x80F78A6), 'int', ['pointer', 'pointer'], { "abi": "sysv" });
var gameworld_user_map_end = new NativeFunction(ptr(0x80F78CC), 'int', ['pointer', 'pointer'], { "abi": "sysv" });
var gameworld_user_map_not_equal = new NativeFunction(ptr(0x80F78F2), 'bool', ['pointer', 'pointer'], { "abi": "sysv" });
var gameworld_user_map_get = new NativeFunction(ptr(0x80F7944), 'pointer', ['pointer'], { "abi": "sysv" });
var gameworld_user_map_next = new NativeFunction(ptr(0x80F7906), 'pointer', ['pointer', 'pointer'], { "abi": "sysv" });

var CUser_get_state = new NativeFunction(ptr(0x80DA38C), 'int', ['pointer'], { "abi": "sysv" });
var CUserCharacInfo_getCurCharacNo = new NativeFunction(ptr(0x80CBC4E), 'int', ['pointer'], { "abi": "sysv" });
var CUser_SendNotiPacketMessage = new NativeFunction(ptr(0x86886CE), 'int', ['pointer', 'pointer', 'int'], { "abi": "sysv" });

// 发系统邮件（多道具）- 用于在线玩家
var WongWork_CMailBoxHelper_ReqDBSendNewSystemMultiMail = new NativeFunction(ptr(0x8556B68), 'int', ['pointer', 'pointer', 'int', 'int', 'int', 'pointer', 'int', 'int', 'int', 'int'], { "abi": "sysv" });

// --------------- 数据库连接配置 ------------------

const AUCTION_DB = 'taiwan_cain_auction_cera';
const FRIDA_DB = 'frida';
const TAIIWAN_CAIN_2ND = 'taiwan_cain_2nd';

// 默认连接参数（从 frida_config.json 的 common.db 读取）
const _defaultConnect = context.config.db;

////////////////////////////////////////////////////////////////////////
// 变量
////////////////////////////////////////////////////////////////////////

var _ready = false;

////////////////////////////////////////////////////////////////////////
// 函数
////////////////////////////////////////////////////////////////////////

/** 获取int值 */
function api_MySQL_get_int(mysql, field_index) {
    var v = Memory.alloc(4);
    if (1 == MySQL_Get_Int(mysql, field_index, v))
        return v.readInt();
    return null;
}

/** 获取uint值 */
function api_MySQL_get_uint(mysql, field_index) {
    var v = Memory.alloc(4);
    if (1 == MySQL_Get_Uint(mysql, field_index, v))
        return v.readUInt();
    return null;
}

/** 获取ulonglong值 */
function api_MySQL_get_ulonglong(mysql, field_index) {
    var v = Memory.alloc(8);
    if (1 == MySQL_Get_Ulonglong(mysql, field_index, v))
        return v.readU64();
    return null;
}

/** 获取binary数据 */
function api_MySQL_get_binary(mysql, field_index) {
    var binary_length = MySQL_Get_Binary_Length(mysql, field_index);
    if (binary_length > 0) {
        var v = Memory.alloc(binary_length);
        if (1 == MySQL_Get_Binary(mysql, field_index, v, binary_length))
            return v.readByteArray(binary_length);
    }
    return null;
}

/** 执行SQL（支持参数化） */
function api_MySQL_exec_safe(mysql, sql) {
    var sql_ptr = Memory.allocUtf8String(sql);
    MySQL_Set_Query_3(mysql, sql_ptr, ptr(0));
    return MySQL_Exec(mysql, 1);
}

/** 执行SQL并获取影响行数 */
function api_MySQL_exec_raw(mysql, sql) {
    var sql_ptr = Memory.allocUtf8String(sql);
    MySQL_Set_Query_3(mysql, sql_ptr, ptr(0));
    return MySQL_Exec(mysql, 0);
}

/** 字符串SQL转义 */
function _escape(s) {
    return ('' + s).replace(/'/g, "''").replace(/\\/g, "\\\\");
}

function _todayStr() {
    var today = new Date();
    var month = today.getMonth() + 1;
    var day = today.getDate();
    return today.getFullYear() + '-' + (month < 10 ? '0' + month : month) + '-' + (day < 10 ? '0' + day : day);
}

function _categoryFromRawCode(rawCode) {
    if (rawCode >= 10000 && rawCode < 12000) return 'equipment';
    if (rawCode >= 12000 && rawCode < 13000) return 'consumable';
    if (rawCode >= 13000 && rawCode < 14000) return 'material';
    if (rawCode >= 31000 && rawCode < 32000) return 'rare';
    return 'junk';
}

/**
 * 判断角色是否在线（state >= 3）
 */
function _isCharacOnline(charac_no) {
    var it = Memory.alloc(8);
    var end = Memory.alloc(8);
    gameworld_user_map_begin(G_GameWorld(), it);
    gameworld_user_map_end(G_GameWorld(), end);

    while (gameworld_user_map_not_equal(it, end)) {
        var user = gameworld_user_map_get(it);
        if (CUser_get_state(user) >= 3 && CUserCharacInfo_getCurCharacNo(user) == charac_no) {
            return user;
        }
        gameworld_user_map_next(it, end);
    }
    return null;
}

/**
 * 发送系统邮件（纯金币，仅在线玩家）
 */
function _sendSystemMailGold(user, charac_no, title, text, gold) {
    var Inven_ItemPr = Memory.alloc(100);
    Inven_Item(Inven_ItemPr);

    var ServerGroup = GetServerGroup(user);
    var TitlePr = Memory.allocUtf8String(title);
    var TxtValuePr = Memory.allocUtf8String(text);
    var TxtValueLength = strlen(TxtValuePr);

    ReqDBSendNewSystemMail(TitlePr, Inven_ItemPr, gold, charac_no, TxtValuePr, TxtValueLength, 30, ServerGroup, 0, 0);
    CUser_SendNotiPacketMessage(user, Memory.allocUtf8String('您在拍卖行上架的商品已被系统回收，请确认邮件'), 0);
}

/**
 * 发送离线邮件（写入 letter + postal 表）
 */
function _sendOfflineMail(mysql_2nd, charac_no, title, text, gold) {
    var now = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var times = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' +
        pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

    // 获取最大 letter_id
    var max_id = 0;
    var tables = ['letter', 'postal'];
    for (var i = 0; i < tables.length; i++) {
        if (api_MySQL_exec_safe(mysql_2nd, "SELECT MAX(letter_id) AS m FROM " + tables[i])) {
            if (MySQL_Get_N_Rows(mysql_2nd) > 0 && MySQL_Fetch(mysql_2nd) == 1) {
                var v = parseInt(api_MySQL_Get_Str(mysql_2nd, 0), 10) || 0;
                if (v > max_id) max_id = v;
            }
        }
    }
    var new_letter_id = max_id + 1;

    // 插入 letter 表
    var letter_sql = "INSERT INTO letter (letter_id, charac_no, send_charac_no, send_charac_name, letter_text, reg_date, stat) VALUES (" +
        new_letter_id + ", " + charac_no + ", 0, '" + _escape(title) + "', '" + _escape(text) + "', '" + times + "', 1)";
    api_MySQL_exec_raw(mysql_2nd, letter_sql);

    // 插入 postal 表
    var postal_sql = "INSERT INTO postal (occ_time, send_charac_no, send_charac_name, receive_charac_no, item_id, add_info, upgrade, amplify_option, receive_time, gold, letter_id) VALUES ('" +
        times + "', 0, '" + _escape(title) + "', " + charac_no + ", 0, 0, 0, 0, '" + times + "', " + gold + ", " + new_letter_id + ")";
    api_MySQL_exec_raw(mysql_2nd, postal_sql);

    return true;
}

////////////////////////////////////////////////////////////////////////
// 导出 API
////////////////////////////////////////////////////////////////////////

const api = {
    isReady() {
        return _ready;
    },

    // ---- 数据库连接 ----

    /** 获取拍卖行数据库连接 */
    getAuctionDb() {
        return dbConnector.get(AUCTION_DB, _defaultConnect.ip, _defaultConnect.port);
    },

    /** 获取 taiwan_cain_2nd 连接（离线邮件用） */
    getCain2ndDb() {
        return dbConnector.get(TAIIWAN_CAIN_2ND, _defaultConnect.ip, _defaultConnect.port);
    },

    /** 获取 frida 数据库连接 */
    getFridaDb() {
        try {
            var mysql = dbConnector.getConFromConfig(FRIDA_DB);
            if (mysql) return mysql;
        } catch (e) {
            // mysql核心模块的连接初始化是异步调度的，auction-bot可能先于连接完成加载。
        }

        try {
            dbConnector.init(FRIDA_DB, _defaultConnect.ip, _defaultConnect.port, _defaultConnect.userName, _defaultConnect.password);
            return dbConnector.get(FRIDA_DB, _defaultConnect.ip, _defaultConnect.port);
        } catch (e2) {
            log(WARN, '[auction] frida数据库连接暂不可用: ' + e2);
            return null;
        }
    },

    // ---- MySQL 底层操作（供引擎直接查询用）----

    /** 执行SQL并返回结果集 */
    execSql(mysql, sql) {
        var sql_ptr = Memory.allocUtf8String(sql);
        MySQL_Set_Query_3(mysql, sql_ptr, ptr(0));
        return MySQL_Exec(mysql, 1);
    },

    /** 执行SQL（不缓存结果） */
    execRaw(mysql, sql) {
        var sql_ptr = Memory.allocUtf8String(sql);
        MySQL_Set_Query_3(mysql, sql_ptr, ptr(0));
        return MySQL_Exec(mysql, 0);
    },

    /** 获取查询行数 */
    getNumRows(mysql) {
        return MySQL_Get_N_Rows(mysql);
    },

    /** 获取下一行 */
    fetchRow(mysql) {
        return MySQL_Fetch(mysql);
    },

    /** 获取int字段 */
    getIntField(mysql, field_index) {
        var v = Memory.alloc(4);
        if (1 == MySQL_Get_Int(mysql, field_index, v))
            return v.readInt();
        return null;
    },

    // ---- 白名单 ----

    /**
     * 获取拍卖行白名单
     * @returns {Array} [{item_id, cname, system_price, quantity, stack_size, upgrade, endurance, seal_flag}]
     */
    getWhitelistItems() {
        var mysql = this.getFridaDb();
        if (!mysql) return [];

        if (!api_MySQL_Exec_Safe(mysql, "SELECT item_id, cname, system_price, quantity, stack_size, upgrade, endurance, seal_flag FROM auction_whitelist"))
            return [];

        var rows = [];
        var n = MySQL_Get_N_Rows(mysql);
        for (var i = 0; i < n; i++) {
            if (MySQL_Fetch(mysql) != 1) break;
            rows.push({
                item_id: api_MySQL_get_int(mysql, 0),
                cname: api_MySQL_Get_Str(mysql, 1),
                system_price: api_MySQL_get_int(mysql, 2),
                quantity: api_MySQL_get_int(mysql, 3) || 1,
                stack_size: api_MySQL_get_int(mysql, 4) || 1,
                upgrade: api_MySQL_get_int(mysql, 5) || 0,
                endurance: api_MySQL_get_int(mysql, 6) || 35,
                seal_flag: api_MySQL_get_int(mysql, 7)
            });
        }
        return rows;
    },

    // ---- 市场画像 ----

    /** 从白名单同步重点常驻物品到 profile */
    syncWhitelistProfiles() {
        var mysql = this.getFridaDb();
        if (!mysql) return false;

        var sql = "INSERT INTO auction_item_profile (" +
            "item_id, cname, category, raw_category_code, market_tier, base_price, " +
            "min_listings, max_listings, min_total_quantity, max_total_quantity, preferred_stack_min, preferred_stack_max, " +
            "volatility, bot_trade_weight, system_trade_weight, enabled, source, category_source, classification_confidence, updated_at" +
            ") SELECT item_id, cname, 'material', 0, 'A', system_price, " +
            "GREATEST(1, CEIL(quantity / GREATEST(stack_size, 1)) DIV 3), GREATEST(3, CEIL(quantity / GREATEST(stack_size, 1))), " +
            "GREATEST(1, quantity DIV 3), GREATEST(1, quantity), 1, GREATEST(1, stack_size), " +
            "0.10, 0.80, 0.50, 1, 'whitelist', 'whitelist', 0.80, NOW() FROM auction_whitelist " +
            "ON DUPLICATE KEY UPDATE cname = VALUES(cname), base_price = VALUES(base_price), market_tier = 'A', " +
            "min_listings = VALUES(min_listings), max_listings = VALUES(max_listings), " +
            "min_total_quantity = VALUES(min_total_quantity), max_total_quantity = VALUES(max_total_quantity), " +
            "preferred_stack_max = VALUES(preferred_stack_max), bot_trade_weight = GREATEST(bot_trade_weight, 0.80), " +
            "system_trade_weight = GREATEST(system_trade_weight, 0.50), source = 'whitelist', updated_at = NOW()";

        return api_MySQL_exec_raw(mysql, sql) == 1;
    },

    /**
     * upsert 单个 iteminfo 候选物品。名称应在调用方完成编码转换。
     */
    upsertItemProfileFromInfo(itemId, cname, rawCategoryCode) {
        var mysql = this.getFridaDb();
        if (!mysql || !itemId) return false;

        var category = _categoryFromRawCode(rawCategoryCode || 0);
        var tier = category === 'material' || category === 'consumable' ? 'B' : 'C';
        var volatility = category === 'equipment' ? 0.35 : (category === 'rare' ? 0.50 : 0.15);
        var botWeight = category === 'junk' ? 0.05 : 0.20;

        var sql = "INSERT INTO auction_item_profile (" +
            "item_id, cname, category, raw_category_code, market_tier, base_price, min_listings, max_listings, " +
            "min_total_quantity, max_total_quantity, preferred_stack_min, preferred_stack_max, volatility, " +
            "bot_trade_weight, system_trade_weight, rotation_weight, enabled, source, category_source, classification_confidence, updated_at" +
            ") VALUES (" +
            itemId + ", '" + _escape(cname || '') + "', '" + category + "', " + (rawCategoryCode || 0) + ", '" + tier + "', 1000, 0, " +
            (tier === 'B' ? 5 : 2) + ", 0, " + (tier === 'B' ? 20 : 3) + ", 1, 1, " + volatility + ", " +
            botWeight + ", 0.00, " + (tier === 'B' ? 0.20 : 0.03) + ", 1, 'iteminfo', 'raw_code', 0.50, NOW()) " +
            "ON DUPLICATE KEY UPDATE cname = IF(cname IS NULL OR cname = '', VALUES(cname), cname), raw_category_code = VALUES(raw_category_code)";

        return api_MySQL_exec_raw(mysql, sql) == 1;
    },

    /** 获取启用的市场物品 profile，默认返回重点常驻和轮换物品 */
    getMarketProfiles(limit, includeNoise) {
        var mysql = this.getFridaDb();
        if (!mysql) return [];

        var sql = "SELECT item_id, cname, category, raw_category_code, market_tier, base_price, min_listings, max_listings, " +
            "min_total_quantity, max_total_quantity, preferred_stack_min, preferred_stack_max, volatility, bot_trade_weight, system_trade_weight, rotation_weight " +
            "FROM auction_item_profile WHERE enabled = 1";
        if (!includeNoise) sql += " AND market_tier IN ('A','B')";
        sql += " ORDER BY FIELD(market_tier, 'A', 'B', 'C'), rotation_weight DESC, item_id";
        if (limit) sql += " LIMIT " + parseInt(limit, 10);

        if (!api_MySQL_Exec_Safe(mysql, sql)) return [];
        var rows = [];
        var n = MySQL_Get_N_Rows(mysql);
        for (var i = 0; i < n; i++) {
            if (MySQL_Fetch(mysql) != 1) break;
            rows.push({
                item_id: api_MySQL_get_int(mysql, 0),
                cname: api_MySQL_Get_Str(mysql, 1),
                category: api_MySQL_Get_Str(mysql, 2),
                raw_category_code: api_MySQL_get_int(mysql, 3),
                market_tier: api_MySQL_Get_Str(mysql, 4),
                base_price: api_MySQL_get_int(mysql, 5) || 1000,
                min_listings: api_MySQL_get_int(mysql, 6) || 0,
                max_listings: api_MySQL_get_int(mysql, 7) || 1,
                min_total_quantity: api_MySQL_get_int(mysql, 8) || 0,
                max_total_quantity: api_MySQL_get_int(mysql, 9) || 1,
                preferred_stack_min: api_MySQL_get_int(mysql, 10) || 1,
                preferred_stack_max: api_MySQL_get_int(mysql, 11) || 1,
                volatility: parseFloat(api_MySQL_Get_Str(mysql, 12)) || 0.15,
                bot_trade_weight: parseFloat(api_MySQL_Get_Str(mysql, 13)) || 0,
                system_trade_weight: parseFloat(api_MySQL_Get_Str(mysql, 14)) || 0,
                rotation_weight: parseFloat(api_MySQL_Get_Str(mysql, 15)) || 0
            });
        }
        return rows;
    },

    /** 获取单个物品 profile */
    getItemProfile(itemId) {
        var rows = [];
        var mysql = this.getFridaDb();
        if (!mysql || !itemId) return null;
        var sql = "SELECT item_id, cname, category, raw_category_code, market_tier, base_price, min_listings, max_listings, " +
            "min_total_quantity, max_total_quantity, preferred_stack_min, preferred_stack_max, volatility, bot_trade_weight, system_trade_weight, rotation_weight, source " +
            "FROM auction_item_profile WHERE item_id = " + itemId;
        if (!api_MySQL_Exec_Safe(mysql, sql)) return null;
        if (MySQL_Get_N_Rows(mysql) == 0 || MySQL_Fetch(mysql) != 1) return null;
        rows.push({
            item_id: api_MySQL_get_int(mysql, 0),
            cname: api_MySQL_Get_Str(mysql, 1),
            category: api_MySQL_Get_Str(mysql, 2),
            raw_category_code: api_MySQL_get_int(mysql, 3),
            market_tier: api_MySQL_Get_Str(mysql, 4),
            base_price: api_MySQL_get_int(mysql, 5) || 1000,
            min_listings: api_MySQL_get_int(mysql, 6) || 0,
            max_listings: api_MySQL_get_int(mysql, 7) || 1,
            min_total_quantity: api_MySQL_get_int(mysql, 8) || 0,
            max_total_quantity: api_MySQL_get_int(mysql, 9) || 1,
            preferred_stack_min: api_MySQL_get_int(mysql, 10) || 1,
            preferred_stack_max: api_MySQL_get_int(mysql, 11) || 1,
            volatility: parseFloat(api_MySQL_Get_Str(mysql, 12)) || 0.15,
            bot_trade_weight: parseFloat(api_MySQL_Get_Str(mysql, 13)) || 0,
            system_trade_weight: parseFloat(api_MySQL_Get_Str(mysql, 14)) || 0,
            rotation_weight: parseFloat(api_MySQL_Get_Str(mysql, 15)) || 0,
            source: api_MySQL_Get_Str(mysql, 16)
        });
        return rows[0];
    },

    /** 手工设置 profile 字段 */
    setItemProfileField(itemId, field, value) {
        var mysql = this.getFridaDb();
        if (!mysql || !itemId || !field) return false;
        var allowed = {
            category: 1, market_tier: 1, base_price: 1, min_listings: 1, max_listings: 1,
            min_total_quantity: 1, max_total_quantity: 1, preferred_stack_min: 1, preferred_stack_max: 1,
            volatility: 1, bot_trade_weight: 1, system_trade_weight: 1, rotation_weight: 1, enabled: 1
        };
        if (!allowed[field]) return false;
        var numeric = field !== 'category' && field !== 'market_tier';
        var v = numeric ? String(parseFloat(value) || 0) : ("'" + _escape(value) + "'");
        return api_MySQL_exec_raw(mysql, "UPDATE auction_item_profile SET " + field + " = " + v + ", source = 'manual', updated_at = NOW() WHERE item_id = " + itemId) == 1;
    },

    // ---- 系统卖家 ----

    /**
     * 获取系统卖家配置
     * @returns {Object} {owner_id, owner_name, owner_nexon_id, owner_type}
     */
    getSystemSeller() {
        var mysql = this.getFridaDb();
        if (!mysql) return null;

        if (!api_MySQL_Exec_Safe(mysql, "SELECT owner_id, owner_name, owner_nexon_id, owner_type FROM auction_system_config WHERE id = 1"))
            return null;

        if (MySQL_Get_N_Rows(mysql) == 0) return null;
        if (MySQL_Fetch(mysql) != 1) return null;

        return {
            owner_id: api_MySQL_get_int(mysql, 0) || 0,
            owner_name: api_MySQL_Get_Str(mysql, 1) || '系统',
            owner_nexon_id: api_MySQL_Get_Str(mysql, 2) || '0',
            owner_type: api_MySQL_get_int(mysql, 3) || 1
        };
    },

    // ---- 假人角色管理 ----

    /**
     * 获取活跃的假人角色
     * @param {string} role 角色类型 ('seller', 'bidder', 'both', null=全部)
     */
    getActiveBotCharacters(role) {
        var mysql = this.getFridaDb();
        if (!mysql) return [];

        var sql = "SELECT charac_no, charac_name, m_id, role, is_active, min_price_margin, max_price_margin, max_listings_per_day, listings_today, last_reset_date, persona_type, tags, activity_level FROM auction_bot_characters WHERE is_active = 1";
        if (role && role !== 'both') {
            sql += " AND (role = '" + _escape(role) + "' OR role = 'both')";
        }

        if (!api_MySQL_Exec_Safe(mysql, sql)) return [];

        var rows = [];
        var n = MySQL_Get_N_Rows(mysql);
        for (var i = 0; i < n; i++) {
            if (MySQL_Fetch(mysql) != 1) break;
            rows.push({
                charac_no: api_MySQL_get_int(mysql, 0),
                charac_name: api_MySQL_Get_Str(mysql, 1),
                m_id: api_MySQL_get_int(mysql, 2),
                role: api_MySQL_Get_Str(mysql, 3) || 'seller',
                is_active: api_MySQL_get_int(mysql, 4),
                min_price_margin: parseFloat(api_MySQL_Get_Str(mysql, 5)) || 1.1,
                max_price_margin: parseFloat(api_MySQL_Get_Str(mysql, 6)) || 1.8,
                max_listings_per_day: api_MySQL_get_int(mysql, 7) || 5,
                listings_today: api_MySQL_get_int(mysql, 8) || 0,
                last_reset_date: api_MySQL_Get_Str(mysql, 9),
                persona_type: api_MySQL_Get_Str(mysql, 10) || 'material_merchant',
                tags: api_MySQL_Get_Str(mysql, 11) || '',
                activity_level: parseFloat(api_MySQL_Get_Str(mysql, 12)) || 1.0
            });
        }
        return rows;
    },

    /** 根据角色名查找角色信息 */
    getCharacByName(charac_name) {
        var mysql = dbConnector.getConFromConfig('taiwan_cain');
        if (!mysql) return null;

        if (!api_MySQL_Exec_Safe(mysql, "SELECT charac_no, m_id, lev FROM charac_info WHERE charac_name='" + _escape(charac_name) + "'"))
            return null;

        if (MySQL_Get_N_Rows(mysql) == 0) return null;
        if (MySQL_Fetch(mysql) != 1) return null;

        return {
            charac_no: api_MySQL_get_int(mysql, 0),
            m_id: api_MySQL_get_int(mysql, 1),
            lev: api_MySQL_get_int(mysql, 2)
        };
    },

    /** 添加假人角色到拍卖池 */
    addBotCharacter(charac_no, charac_name, m_id, role) {
        var mysql = this.getFridaDb();
        if (!mysql) return false;

        var sql = "INSERT INTO auction_bot_characters (charac_no, charac_name, m_id, role, is_active, min_price_margin, max_price_margin, max_listings_per_day, listings_today) VALUES (" +
            charac_no + ", '" + _escape(charac_name) + "', " + m_id + ", '" + _escape(role || 'seller') + "', 1, 1.1, 1.8, 5, 0) " +
            "ON DUPLICATE KEY UPDATE charac_name = VALUES(charac_name), m_id = VALUES(m_id), is_active = 1";

        var ok = api_MySQL_exec_raw(mysql, sql) == 1;
        if (ok) this.ensureBotWallet(charac_no);
        return ok;
    },

    /** 移除假人角色 */
    removeBotCharacter(charac_no) {
        var mysql = this.getFridaDb();
        if (!mysql) return false;
        return api_MySQL_exec_raw(mysql, "UPDATE auction_bot_characters SET is_active = 0 WHERE charac_no = " + charac_no) == 1;
    },

    /** 设置假人角色类型 */
    setBotCharacterRole(charac_no, role) {
        var mysql = this.getFridaDb();
        if (!mysql) return false;
        return api_MySQL_exec_raw(mysql, "UPDATE auction_bot_characters SET role = '" + _escape(role) + "' WHERE charac_no = " + charac_no) == 1;
    },

    /** 更新假人每日上架计数 */
    updateBotListingsToday(charac_no, count) {
        var mysql = this.getFridaDb();
        if (!mysql) return;
        var today = new Date();
        var dateStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        // 同时重置日期
        api_MySQL_exec_raw(mysql,
            "UPDATE auction_bot_characters SET listings_today = " + count +
            ", last_listing_time = NOW(), last_reset_date = '" + dateStr + "' WHERE charac_no = " + charac_no);
    },

    /** 检查并重置每日计数（跨天自动重置） */
    resetDailyCountersIfNeeded() {
        var mysql = this.getFridaDb();
        if (!mysql) return;
        var today = new Date();
        var dateStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        api_MySQL_exec_raw(mysql,
            "UPDATE auction_bot_characters SET listings_today = 0, last_reset_date = '" + dateStr +
            "' WHERE last_reset_date IS NULL OR last_reset_date < '" + dateStr + "'");
    },

    // ---- 钱包与经济台账 ----

    /** 确保 bot 钱包存在 */
    ensureBotWallet(charac_no) {
        var mysql = this.getFridaDb();
        if (!mysql || !charac_no) return false;
        var sql = "INSERT IGNORE INTO auction_bot_wallet (charac_no, gold_balance, credit_limit, reserved_gold, daily_spend_limit, daily_bid_limit, last_reset_date) VALUES (" +
            charac_no + ", 0, 10000000, 0, 5000000, 5000000, '" + _todayStr() + "')";
        return api_MySQL_exec_raw(mysql, sql) == 1;
    },

    /** 获取 bot 钱包 */
    getBotWallet(charac_no) {
        var mysql = this.getFridaDb();
        if (!mysql || !charac_no) return null;
        this.ensureBotWallet(charac_no);
        var sql = "SELECT charac_no, gold_balance, credit_limit, reserved_gold, daily_spend_limit, daily_bid_limit, spent_today, earned_today, injected_today, sink_today, last_reset_date FROM auction_bot_wallet WHERE charac_no = " + charac_no;
        if (!api_MySQL_Exec_Safe(mysql, sql)) return null;
        if (MySQL_Get_N_Rows(mysql) == 0 || MySQL_Fetch(mysql) != 1) return null;
        return {
            charac_no: api_MySQL_get_int(mysql, 0),
            gold_balance: api_MySQL_get_int(mysql, 1) || 0,
            credit_limit: api_MySQL_get_int(mysql, 2) || 0,
            reserved_gold: api_MySQL_get_int(mysql, 3) || 0,
            daily_spend_limit: api_MySQL_get_int(mysql, 4) || 0,
            daily_bid_limit: api_MySQL_get_int(mysql, 5) || 0,
            spent_today: api_MySQL_get_int(mysql, 6) || 0,
            earned_today: api_MySQL_get_int(mysql, 7) || 0,
            injected_today: api_MySQL_get_int(mysql, 8) || 0,
            sink_today: api_MySQL_get_int(mysql, 9) || 0,
            last_reset_date: api_MySQL_Get_Str(mysql, 10)
        };
    },

    /** 每日重置钱包计数 */
    resetWalletDailyCountersIfNeeded(charac_no) {
        var mysql = this.getFridaDb();
        if (!mysql || !charac_no) return;
        api_MySQL_exec_raw(mysql,
            "UPDATE auction_bot_wallet SET spent_today = 0, earned_today = 0, injected_today = 0, sink_today = 0, last_reset_date = '" + _todayStr() +
            "' WHERE charac_no = " + charac_no + " AND (last_reset_date IS NULL OR last_reset_date < '" + _todayStr() + "')");
    },

    /** 检查并扣减 bot 预算 */
    spendBotGold(charac_no, amount, reason) {
        var mysql = this.getFridaDb();
        if (!mysql || !charac_no || amount <= 0) return false;
        this.ensureBotWallet(charac_no);
        this.resetWalletDailyCountersIfNeeded(charac_no);
        var wallet = this.getBotWallet(charac_no);
        if (!wallet) return false;
        var available = wallet.gold_balance + wallet.credit_limit - wallet.reserved_gold;
        if (available < amount) return false;
        if (wallet.daily_spend_limit > 0 && wallet.spent_today + amount > wallet.daily_spend_limit) return false;
        var sql = "UPDATE auction_bot_wallet SET gold_balance = gold_balance - " + amount +
            ", spent_today = spent_today + " + amount + ", updated_at = NOW() WHERE charac_no = " + charac_no;
        return api_MySQL_exec_raw(mysql, sql) == 1;
    },

    /** 增加 bot 收入 */
    earnBotGold(charac_no, amount, reason) {
        var mysql = this.getFridaDb();
        if (!mysql || !charac_no || amount <= 0) return false;
        this.ensureBotWallet(charac_no);
        this.resetWalletDailyCountersIfNeeded(charac_no);
        var sql = "UPDATE auction_bot_wallet SET gold_balance = gold_balance + " + amount +
            ", earned_today = earned_today + " + amount + ", updated_at = NOW() WHERE charac_no = " + charac_no;
        return api_MySQL_exec_raw(mysql, sql) == 1;
    },

    /** 记录经济台账 */
    logEconomyEvent(ev) {
        var mysql = this.getFridaDb();
        if (!mysql || !ev) return false;
        var sql = "INSERT INTO auction_economy_ledger (" +
            "event_type, source, auction_id, actor_type, actor_id, counterparty_type, counterparty_id, item_id, quantity, unit_price, total_price, gold_delta, item_delta, reason, created_at" +
            ") VALUES ('" +
            _escape(ev.event_type || 'unknown') + "', '" + _escape(ev.source || 'plugin') + "', " + (ev.auction_id || 0) + ", '" +
            _escape(ev.actor_type || 'system') + "', " + (ev.actor_id || 0) + ", '" + _escape(ev.counterparty_type || 'unknown') + "', " +
            (ev.counterparty_id || 0) + ", " + (ev.item_id || 0) + ", " + (ev.quantity || 0) + ", " + (ev.unit_price || 0) + ", " +
            (ev.total_price || 0) + ", " + (ev.gold_delta || 0) + ", " + (ev.item_delta || 0) + ", '" + _escape(ev.reason || '') + "', NOW())";
        return api_MySQL_exec_raw(mysql, sql) == 1;
    },

    /** 最近经济台账 */
    getLedgerRows(filter, limit) {
        var mysql = this.getFridaDb();
        if (!mysql) return [];
        var sql = "SELECT event_type, actor_type, actor_id, counterparty_type, counterparty_id, item_id, quantity, unit_price, total_price, gold_delta, reason, created_at FROM auction_economy_ledger WHERE 1=1";
        if (filter && filter.item_id) sql += " AND item_id = " + parseInt(filter.item_id, 10);
        if (filter && filter.actor_id) sql += " AND (actor_id = " + parseInt(filter.actor_id, 10) + " OR counterparty_id = " + parseInt(filter.actor_id, 10) + ")";
        sql += " ORDER BY id DESC LIMIT " + (limit || 10);
        if (!api_MySQL_Exec_Safe(mysql, sql)) return [];
        var rows = [];
        var n = MySQL_Get_N_Rows(mysql);
        for (var i = 0; i < n; i++) {
            if (MySQL_Fetch(mysql) != 1) break;
            rows.push({
                event_type: api_MySQL_Get_Str(mysql, 0),
                actor_type: api_MySQL_Get_Str(mysql, 1),
                actor_id: api_MySQL_get_int(mysql, 2),
                counterparty_type: api_MySQL_Get_Str(mysql, 3),
                counterparty_id: api_MySQL_get_int(mysql, 4),
                item_id: api_MySQL_get_int(mysql, 5),
                quantity: api_MySQL_get_int(mysql, 6),
                unit_price: api_MySQL_get_int(mysql, 7),
                total_price: api_MySQL_get_int(mysql, 8),
                gold_delta: api_MySQL_get_int(mysql, 9),
                reason: api_MySQL_Get_Str(mysql, 10),
                created_at: api_MySQL_Get_Str(mysql, 11)
            });
        }
        return rows;
    },

    /** 全局经济健康概览 */
    getEconomyHealth() {
        var mysql = this.getFridaDb();
        if (!mysql) return null;
        var result = { injected: 0, sink: 0, bot_spent: 0, bot_earned: 0, events: 0 };
        var sql = "SELECT COUNT(*), COALESCE(SUM(CASE WHEN gold_delta > 0 THEN gold_delta ELSE 0 END), 0), COALESCE(SUM(CASE WHEN gold_delta < 0 THEN -gold_delta ELSE 0 END), 0) " +
            "FROM auction_economy_ledger WHERE created_at >= CURDATE()";
        if (api_MySQL_Exec_Safe(mysql, sql) && MySQL_Get_N_Rows(mysql) > 0 && MySQL_Fetch(mysql) == 1) {
            result.events = api_MySQL_get_int(mysql, 0) || 0;
            result.injected = api_MySQL_get_int(mysql, 1) || 0;
            result.sink = api_MySQL_get_int(mysql, 2) || 0;
        }
        if (api_MySQL_Exec_Safe(mysql, "SELECT COALESCE(SUM(spent_today),0), COALESCE(SUM(earned_today),0) FROM auction_bot_wallet") && MySQL_Get_N_Rows(mysql) > 0 && MySQL_Fetch(mysql) == 1) {
            result.bot_spent = api_MySQL_get_int(mysql, 0) || 0;
            result.bot_earned = api_MySQL_get_int(mysql, 1) || 0;
        }
        return result;
    },

    // ---- 拍卖行扫描 ----

    /**
     * 扫描拍卖行在售物品
     * @param {number} itemId 物品ID（可选，不传则扫全部白名单物品）
     * @returns {Array} 在售物品列表
     */
    scanAuctionListings(itemId) {
        var auctionDb = this.getAuctionDb();
        if (!auctionDb) return [];

        var sql = "SELECT auction_id, owner_id, owner_name, owner_type, item_id, unit_price, instant_price, add_info, upgrade, endurance, seal_flag, expire_time, occ_time FROM auction_main WHERE expire_time > NOW()";
        if (itemId) {
            sql += " AND item_id = " + itemId;
        }

        if (!api_MySQL_exec_safe(auctionDb, sql)) return [];

        var rows = [];
        var n = MySQL_Get_N_Rows(auctionDb);
        for (var i = 0; i < n; i++) {
            if (MySQL_Fetch(auctionDb) != 1) break;
            rows.push({
                auction_id: api_MySQL_get_int(auctionDb, 0),
                owner_id: api_MySQL_get_int(auctionDb, 1),
                owner_name: api_MySQL_Get_Str(auctionDb, 2),
                owner_type: api_MySQL_get_int(auctionDb, 3),
                item_id: api_MySQL_get_int(auctionDb, 4),
                unit_price: api_MySQL_get_int(auctionDb, 5),
                instant_price: api_MySQL_get_int(auctionDb, 6),
                add_info: api_MySQL_get_int(auctionDb, 7),
                upgrade: api_MySQL_get_int(auctionDb, 8),
                endurance: api_MySQL_get_int(auctionDb, 9),
                seal_flag: api_MySQL_get_int(auctionDb, 10),
                expire_time: api_MySQL_get_int(auctionDb, 11),
                occ_time: api_MySQL_Get_Str(auctionDb, 12)
            });
        }
        return rows;
    },

    /**
     * 获取物品拍卖行统计
     * @returns {Object} {total_listings, avg_price, min_price, max_price, total_quantity}
     */
    getAuctionStats(itemId) {
        var auctionDb = this.getAuctionDb();
        if (!auctionDb) return null;

        var sql = "SELECT COUNT(*), COALESCE(AVG(unit_price), 0), COALESCE(MIN(unit_price), 0), COALESCE(MAX(unit_price), 0), COALESCE(SUM(add_info), 0) FROM auction_main WHERE item_id = " + itemId + " AND expire_time > NOW()";
        if (!api_MySQL_exec_safe(auctionDb, sql)) return null;

        if (MySQL_Get_N_Rows(auctionDb) == 0) return null;
        if (MySQL_Fetch(auctionDb) != 1) return null;

        return {
            total_listings: api_MySQL_get_int(auctionDb, 0),
            avg_price: api_MySQL_get_int(auctionDb, 1),
            min_price: api_MySQL_get_int(auctionDb, 2),
            max_price: api_MySQL_get_int(auctionDb, 3),
            total_quantity: api_MySQL_get_int(auctionDb, 4)
        };
    },

    /**
     * 获取下一个拍卖ID
     */
    getNextAuctionId() {
        var auctionDb = this.getAuctionDb();
        if (!auctionDb) return 1;

        if (!api_MySQL_exec_safe(auctionDb, "SELECT COALESCE(MAX(auction_id), 0) FROM auction_main"))
            return 1;

        if (MySQL_Get_N_Rows(auctionDb) == 0) return 1;
        if (MySQL_Fetch(auctionDb) != 1) return 1;

        return api_MySQL_get_int(auctionDb, 0) + 1;
    },

    // ---- 拍卖操作 ----

    /**
     * 系统收购物品（插入pending_mail + 删除listing）
     * @param {number} auctionId 拍卖ID
     * @param {number} sellerId 卖家charac_no
     * @param {number} sellPrice 收购价格
     * @param {number} itemId 物品ID
     * @param {string} itemName 物品名
     */
    buyAuctionItem(auctionId, sellerId, sellPrice, itemId, itemName) {
        var fridaDb = this.getFridaDb();
        var auctionDb = this.getAuctionDb();
        if (!fridaDb || !auctionDb) return false;

        var DEPOSIT = 10000;
        var FEE_RATE = 0.03;
        var fee = Math.floor(sellPrice * FEE_RATE);
        var gold = sellPrice - fee + DEPOSIT;
        var title = '拍卖行';
        var itemDesc = (itemName || ('item_id=' + itemId)).substring(0, 12);
        var text = '[您上架的 ' + itemDesc + ' 已被系统回收]\n  成交价 + ' + sellPrice +
            '\n  押金 + ' + DEPOSIT + '\n  手续费 - ' + fee + '\n共 ' + gold + ' 金币。';

        // 插入待发邮件
        var mailSql = "INSERT INTO pending_mail (charac_no, title, text, gold, status) VALUES (" +
            sellerId + ", '" + _escape(title) + "', '" + _escape(text) + "', " + gold + ", 0)";
        api_MySQL_exec_raw(fridaDb, mailSql);

        // 删除拍卖行记录
        api_MySQL_exec_raw(auctionDb, "DELETE FROM auction_main WHERE auction_id = " + auctionId);

        return true;
    },

    /**
     * 系统上架物品
     * @param {Object} listing {owner_id, owner_name, owner_type, owner_nexon_id, item_id, unit_price, add_info, upgrade, endurance, seal_flag}
     */
    listAuctionItem(listing) {
        var auctionDb = this.getAuctionDb();
        if (!auctionDb) return false;

        var nextId = this.getNextAuctionId();
        var expireTime = Math.floor(Date.now() / 1000) + 48 * 3600; // 48小时

        var instant_price = listing.unit_price * (listing.add_info || 1);

        var sql = "INSERT INTO auction_main (" +
            "auction_id, occ_time, expire_time, " +
            "owner_id, owner_name, owner_type, owner_nexon_id, " +
            "buyer_id, buyer_name, price, instant_price, " +
            "seal_flag, item_id, add_info, upgrade, " +
            "amplify_option, amplify_value, seal_cnt, endurance, " +
            "extend_info, black_point, unit_price, " +
            "random_option, roi_high_key, roi_low_key, seperate_upgrade, item_guid" +
            ") VALUES (" +
            nextId + ", NOW(), " + expireTime + ", " +
            listing.owner_id + ", '" + _escape((listing.owner_name || '系统').substring(0, 20)) + "', " + (listing.owner_type || 1) + ", '" + _escape((listing.owner_nexon_id || '0').substring(0, 25)) + "', " +
            "-1, '', -1, " + instant_price + ", " +
            (listing.seal_flag != null ? listing.seal_flag : 1) + ", " + listing.item_id + ", " + (listing.add_info || 1) + ", " + (listing.upgrade || 0) + ", " +
            "0, 0, 0, " + (listing.endurance != null ? listing.endurance : 35) + ", " +
            "0, 0, " + listing.unit_price + ", " +
            "UNHEX(REPEAT('00', 14)), 0, 0, 0, UNHEX(REPEAT('00', 10))" +
            ")";

        return api_MySQL_exec_raw(auctionDb, sql) == 1;
    },

    // ---- 邮件处理 ----

    /**
     * 处理待发邮件队列
     * 在线玩家通过游戏函数发邮件，离线玩家写入 letter/postal 表
     */
    processPendingMail() {
        var fridaDb = this.getFridaDb();
        if (!fridaDb) return;

        if (!api_MySQL_Exec_Safe(fridaDb, "SELECT id, charac_no, title, text, gold FROM pending_mail WHERE status = 0 ORDER BY id LIMIT 20"))
            return;

        var n = MySQL_Get_N_Rows(fridaDb);
        if (n == 0) return;

        var rows = [];
        for (var i = 0; i < n; i++) {
            if (MySQL_Fetch(fridaDb) != 1) break;
            rows.push({
                id: api_MySQL_get_int(fridaDb, 0),
                charac_no: api_MySQL_get_int(fridaDb, 1),
                title: api_MySQL_Get_Str(fridaDb, 2),
                text: api_MySQL_Get_Str(fridaDb, 3),
                gold: api_MySQL_get_int(fridaDb, 4)
            });
        }

        for (var j = 0; j < rows.length; j++) {
            var r = rows[j];
            try {
                var user = _isCharacOnline(r.charac_no);
                if (user) {
                    _sendSystemMailGold(user, r.charac_no, r.title, r.text, r.gold);
                } else {
                    var cain2ndDb = this.getCain2ndDb();
                    if (cain2ndDb) {
                        _sendOfflineMail(cain2ndDb, r.charac_no, r.title, r.text, r.gold);
                    } else {
                        continue; // 无法发邮件，跳过
                    }
                }
                api_MySQL_exec_safe(fridaDb, "UPDATE pending_mail SET status = 1 WHERE id = " + r.id);
            } catch (e) {
                log(ERROR, '[auction] 发送邮件失败 id=' + r.id + ' err=' + e);
            }
        }
    },

    // ---- 配置管理 ----

    /**
     * 获取机器人配置
     * @param {string} key 配置键
     * @returns {string} 配置值
     */
    getBotConfig(key) {
        var mysql = this.getFridaDb();
        if (!mysql) return null;

        if (!api_MySQL_Exec_Safe(mysql, "SELECT config_value FROM auction_bot_config WHERE config_key = '" + _escape(key) + "'"))
            return null;

        if (MySQL_Get_N_Rows(mysql) == 0) return null;
        if (MySQL_Fetch(mysql) != 1) return null;

        return api_MySQL_Get_Str(mysql, 0);
    },

    /**
     * 设置机器人配置
     */
    setBotConfig(key, value, description) {
        var mysql = this.getFridaDb();
        if (!mysql) return false;

        var desc = description || '';
        var sql = "INSERT INTO auction_bot_config (config_key, config_value, description, updated_at) VALUES ('" +
            _escape(key) + "', '" + _escape(String(value)) + "', '" + _escape(desc) + "', NOW()) " +
            "ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()";

        return api_MySQL_exec_raw(mysql, sql) == 1;
    },

    /**
     * 获取所有配置
     */
    getAllBotConfig() {
        var mysql = this.getFridaDb();
        if (!mysql) return {};

        if (!api_MySQL_Exec_Safe(mysql, "SELECT config_key, config_value FROM auction_bot_config"))
            return {};

        var config = {};
        var n = MySQL_Get_N_Rows(mysql);
        for (var i = 0; i < n; i++) {
            if (MySQL_Fetch(mysql) != 1) break;
            var key = api_MySQL_Get_Str(mysql, 0);
            var val = api_MySQL_Get_Str(mysql, 1);
            if (key) config[key] = val;
        }
        return config;
    },

    // ---- 操作日志 ----

    /**
     * 记录操作日志
     */
    logOperation(operation_type, item_id, auction_id, seller_id, buyer_id, price, quantity, detail) {
        var mysql = this.getFridaDb();
        if (!mysql) return;

        var sql = "INSERT INTO auction_bot_log (operation_type, item_id, auction_id, seller_id, buyer_id, price, quantity, detail, created_at) VALUES ('" +
            _escape(operation_type) + "', " + (item_id || 0) + ", " + (auction_id || 0) + ", " + (seller_id || 0) + ", " +
            (buyer_id || 0) + ", " + (price || 0) + ", " + (quantity || 0) + ", '" + _escape(detail || '') + "', NOW())";

        api_MySQL_exec_raw(mysql, sql);
    },

    // ---- 价格历史 ----

    /**
     * 记录物品价格快照
     */
    recordPriceSnapshot(itemId) {
        var mysql = this.getFridaDb();
        var auctionDb = this.getAuctionDb();
        if (!mysql || !auctionDb) return;

        // 查询当前在售情况
        var sql = "SELECT COUNT(*), COALESCE(AVG(unit_price), 0), COALESCE(MIN(unit_price), 0), COALESCE(MAX(unit_price), 0), COALESCE(SUM(add_info), 0) FROM auction_main WHERE item_id = " + itemId + " AND expire_time > NOW()";
        if (!api_MySQL_exec_safe(auctionDb, sql)) return;

        if (MySQL_Get_N_Rows(auctionDb) == 0) return;
        if (MySQL_Fetch(auctionDb) != 1) return;

        var total_listings = api_MySQL_get_int(auctionDb, 0) || 0;
        var avg_price = api_MySQL_get_int(auctionDb, 1) || 0;
        var min_price = api_MySQL_get_int(auctionDb, 2) || 0;
        var max_price = api_MySQL_get_int(auctionDb, 3) || 0;
        var total_quantity = api_MySQL_get_int(auctionDb, 4) || 0;

        var insertSql = "INSERT INTO auction_price_history (item_id, total_listings, avg_price, min_price, max_price, total_quantity, recent_sales_24h) VALUES (" +
            itemId + ", " + total_listings + ", " + avg_price + ", " + min_price + ", " + max_price + ", " + total_quantity + ", 0)";

        api_MySQL_exec_raw(mysql, insertSql);
    },

    /**
     * 获取价格历史
     * @param {number} itemId
     * @param {number} hours 回溯小时数
     */
    getPriceHistory(itemId, hours) {
        var mysql = this.getFridaDb();
        if (!mysql) return [];

        var sql = "SELECT total_listings, avg_price, min_price, max_price, total_quantity, snapshot_time FROM auction_price_history WHERE item_id = " + itemId + " AND snapshot_time >= DATE_SUB(NOW(), INTERVAL " + (hours || 24) + " HOUR) ORDER BY snapshot_time DESC";

        if (!api_MySQL_Exec_Safe(mysql, sql)) return [];

        var rows = [];
        var n = MySQL_Get_N_Rows(mysql);
        for (var i = 0; i < n; i++) {
            if (MySQL_Fetch(mysql) != 1) break;
            rows.push({
                total_listings: api_MySQL_get_int(mysql, 0),
                avg_price: api_MySQL_get_int(mysql, 1),
                min_price: api_MySQL_get_int(mysql, 2),
                max_price: api_MySQL_get_int(mysql, 3),
                total_quantity: api_MySQL_get_int(mysql, 4),
                snapshot_time: api_MySQL_Get_Str(mysql, 5)
            });
        }
        return rows;
    },

    // ---- 价格计算 ----

    /**
     * 计算市场调整价格
     * @param {number} systemPrice 系统基准价
     * @param {number} itemId 物品ID
     * @returns {number} 调整后的价格
     */
    calculateMarketPrice(systemPrice, itemId) {
        var stats = this.getAuctionStats(itemId);
        var history = this.getPriceHistory(itemId, 168); // 7天

        var supplyFactor = 0;
        var demandFactor = 0;

        if (history.length > 0) {
            var avgSupply = 0;
            for (var i = 0; i < history.length; i++) {
                avgSupply += history[i].total_listings;
            }
            avgSupply = avgSupply / history.length;

            if (avgSupply > 0 && stats && stats.total_listings !== null) {
                var supplyRatio = stats.total_listings / avgSupply;

                if (supplyRatio < 0.5) {
                    supplyFactor = 0.20; // 稀缺 +20%
                } else if (supplyRatio > 2.0) {
                    supplyFactor = -0.15; // 过剩 -15%
                } else {
                    supplyFactor = (1 - supplyRatio) * 0.2; // 线性插值
                }
            }

            // 需求因子：最近24h销量 vs 平均
            var recentSales = history.length > 0 ? (history[0].recent_sales_24h || 0) : 0;
            var avgSales = 0;
            for (var j = 0; j < Math.min(history.length, 7); j++) {
                avgSales += history[j].recent_sales_24h || 0;
            }
            avgSales = avgSales / Math.min(history.length, 7);

            if (avgSales > 0 && recentSales > 0) {
                var demandRatio = recentSales / avgSales;
                demandFactor = (demandRatio - 1) * 0.15;
            }
        }

        var adjustedPrice = systemPrice * (1 + supplyFactor + demandFactor);
        // 限制在 [0.5x, 3x] 范围内
        adjustedPrice = Math.max(systemPrice * 0.5, Math.min(systemPrice * 3.0, adjustedPrice));

        return Math.floor(adjustedPrice);
    }
};

////////////////////////////////////////////////////////////////////////
// 导出
////////////////////////////////////////////////////////////////////////

module.exports = {
    init() {
        log(INFO, '[auction] 初始化拍卖行基础模块...');

        // 初始化拍卖行数据库连接
        var config = {
            ip: _defaultConnect.ip,
            port: _defaultConnect.port,
            userName: _defaultConnect.userName,
            password: _defaultConnect.password
        };

        // 连接 taiwan_cain_auction_cera
        if (!dbConnector.init(AUCTION_DB, config.ip, config.port, config.userName, config.password)) {
            log(WARN, '[auction] 无法连接 ' + AUCTION_DB + '，尝试创建...');
            // 尝试创建数据库
            var tmpMysql = dbConnector.get('', config.ip, config.port) || dbConnector.get('taiwan_cain', config.ip, config.port);
            if (!tmpMysql) {
                dbConnector.init('', config.ip, config.port, config.userName, config.password);
                tmpMysql = dbConnector.get('', config.ip, config.port);
            }
            if (tmpMysql) {
                api_MySQL_exec_safe(tmpMysql, "CREATE DATABASE IF NOT EXISTS `" + AUCTION_DB + "` DEFAULT CHARACTER SET utf8");
                dbConnector.init(AUCTION_DB, config.ip, config.port, config.userName, config.password);
            }
        }

        // 连接 taiwan_cain_2nd（离线邮件用）
        dbConnector.init(TAIIWAN_CAIN_2ND, config.ip, config.port, config.userName, config.password);

        // 创建 frida 数据库中的表（延迟执行，等待 mysql 模块的 _initConnections 完成）
        var initFridaTables = function () {
            var fridaDb = api.getFridaDb();
            if (fridaDb) {
                // 白名单表（可能已由 Python 脚本创建）
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS auction_whitelist (" +
                "item_id int unsigned NOT NULL PRIMARY KEY," +
                "cname varchar(64) DEFAULT NULL," +
                "system_price int NOT NULL," +
                "quantity int NOT NULL DEFAULT 1," +
                "stack_size int NOT NULL DEFAULT 1," +
                "upgrade tinyint unsigned DEFAULT 0," +
                "endurance smallint unsigned DEFAULT 35," +
                "seal_flag tinyint unsigned DEFAULT 1" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");

            // 系统卖家配置表
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS auction_system_config (" +
                "id tinyint PRIMARY KEY DEFAULT 1," +
                "owner_id int NOT NULL DEFAULT 0," +
                "owner_name varchar(20) NOT NULL DEFAULT '系统'," +
                "owner_nexon_id varchar(25) NOT NULL DEFAULT '0'," +
                "owner_type tinyint NOT NULL DEFAULT 1" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");
            api_MySQL_exec_raw(fridaDb, "INSERT IGNORE INTO auction_system_config (id) VALUES (1)");

            // 待发邮件表
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS pending_mail (" +
                "id int AUTO_INCREMENT PRIMARY KEY," +
                "charac_no int NOT NULL," +
                "title varchar(64) NOT NULL," +
                "text varchar(255) NOT NULL," +
                "gold int NOT NULL DEFAULT 0," +
                "status tinyint NOT NULL DEFAULT 0," +
                "created_at datetime DEFAULT CURRENT_TIMESTAMP," +
                "KEY idx_status (status)" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");

            // 机器人配置表
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS auction_bot_config (" +
                "config_key varchar(64) PRIMARY KEY," +
                "config_value varchar(256) NOT NULL," +
                "description varchar(256) DEFAULT NULL," +
                "updated_at datetime DEFAULT NULL" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");

            // 操作日志表
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS auction_bot_log (" +
                "id bigint AUTO_INCREMENT PRIMARY KEY," +
                "operation_type varchar(32) NOT NULL," +
                "item_id int DEFAULT 0," +
                "auction_id bigint DEFAULT 0," +
                "seller_id int DEFAULT 0," +
                "buyer_id int DEFAULT 0," +
                "price bigint DEFAULT 0," +
                "quantity int DEFAULT 0," +
                "detail text," +
                "created_at datetime DEFAULT CURRENT_TIMESTAMP" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");

            // 价格历史表
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS auction_price_history (" +
                "id bigint AUTO_INCREMENT PRIMARY KEY," +
                "item_id int NOT NULL," +
                "snapshot_time datetime DEFAULT CURRENT_TIMESTAMP," +
                "total_listings int DEFAULT 0," +
                "avg_price bigint DEFAULT 0," +
                "min_price bigint DEFAULT 0," +
                "max_price bigint DEFAULT 0," +
                "total_quantity int DEFAULT 0," +
                "recent_sales_24h int DEFAULT 0" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");

            // 物品市场画像表
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS auction_item_profile (" +
                "item_id int unsigned NOT NULL PRIMARY KEY," +
                "cname varchar(64) DEFAULT NULL," +
                "category varchar(32) NOT NULL DEFAULT 'unknown'," +
                "raw_category_code int unsigned DEFAULT 0," +
                "market_tier char(1) NOT NULL DEFAULT 'C'," +
                "base_price bigint NOT NULL DEFAULT 1000," +
                "min_listings int NOT NULL DEFAULT 0," +
                "max_listings int NOT NULL DEFAULT 1," +
                "min_total_quantity int NOT NULL DEFAULT 0," +
                "max_total_quantity int NOT NULL DEFAULT 1," +
                "preferred_stack_min int NOT NULL DEFAULT 1," +
                "preferred_stack_max int NOT NULL DEFAULT 1," +
                "volatility decimal(5,2) NOT NULL DEFAULT 0.15," +
                "bot_trade_weight decimal(5,2) NOT NULL DEFAULT 0.10," +
                "system_trade_weight decimal(5,2) NOT NULL DEFAULT 0.00," +
                "rotation_weight decimal(5,2) NOT NULL DEFAULT 0.03," +
                "enabled tinyint NOT NULL DEFAULT 1," +
                "source varchar(32) DEFAULT 'iteminfo'," +
                "category_source varchar(32) DEFAULT 'raw_code'," +
                "classification_confidence decimal(4,2) DEFAULT 0.50," +
                "suggested_price bigint DEFAULT 0," +
                "suggested_tier char(1) DEFAULT NULL," +
                "updated_at datetime DEFAULT NULL," +
                "KEY idx_tier_enabled (market_tier, enabled)," +
                "KEY idx_category (category)" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");

            // Bot虚拟钱包
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS auction_bot_wallet (" +
                "charac_no int NOT NULL PRIMARY KEY," +
                "gold_balance bigint NOT NULL DEFAULT 0," +
                "credit_limit bigint NOT NULL DEFAULT 10000000," +
                "reserved_gold bigint NOT NULL DEFAULT 0," +
                "risk_score decimal(5,2) NOT NULL DEFAULT 0.00," +
                "daily_spend_limit bigint NOT NULL DEFAULT 5000000," +
                "daily_bid_limit bigint NOT NULL DEFAULT 5000000," +
                "spent_today bigint NOT NULL DEFAULT 0," +
                "earned_today bigint NOT NULL DEFAULT 0," +
                "injected_today bigint NOT NULL DEFAULT 0," +
                "sink_today bigint NOT NULL DEFAULT 0," +
                "last_reset_date date DEFAULT NULL," +
                "updated_at datetime DEFAULT NULL" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");

            // 经济台账
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS auction_economy_ledger (" +
                "id bigint AUTO_INCREMENT PRIMARY KEY," +
                "event_type varchar(32) NOT NULL," +
                "source varchar(32) DEFAULT 'plugin'," +
                "native_table varchar(64) DEFAULT NULL," +
                "native_row_id varchar(64) DEFAULT NULL," +
                "auction_id bigint DEFAULT 0," +
                "actor_type varchar(16) DEFAULT 'system'," +
                "actor_id int DEFAULT 0," +
                "counterparty_type varchar(16) DEFAULT 'unknown'," +
                "counterparty_id int DEFAULT 0," +
                "item_id int DEFAULT 0," +
                "quantity int DEFAULT 0," +
                "unit_price bigint DEFAULT 0," +
                "total_price bigint DEFAULT 0," +
                "gold_delta bigint DEFAULT 0," +
                "item_delta int DEFAULT 0," +
                "reason varchar(255) DEFAULT NULL," +
                "created_at datetime DEFAULT CURRENT_TIMESTAMP," +
                "KEY idx_created_at (created_at)," +
                "KEY idx_item_time (item_id, created_at)," +
                "KEY idx_actor_time (actor_type, actor_id, created_at)," +
                "KEY idx_event_time (event_type, created_at)" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");

            // 假人角色表
            api_MySQL_exec_raw(fridaDb,
                "CREATE TABLE IF NOT EXISTS auction_bot_characters (" +
                "charac_no int PRIMARY KEY," +
                "charac_name varchar(64) DEFAULT NULL," +
                "m_id int DEFAULT 0," +
                "role varchar(32) DEFAULT 'seller'," +
                "is_active tinyint DEFAULT 1," +
                "min_price_margin decimal(3,2) DEFAULT 1.10," +
                "max_price_margin decimal(3,2) DEFAULT 1.80," +
                "max_listings_per_day int DEFAULT 5," +
                "listings_today int DEFAULT 0," +
                "last_listing_time datetime DEFAULT NULL," +
                "last_reset_date date DEFAULT NULL" +
                ") ENGINE=InnoDB DEFAULT CHARSET=utf8");
            api_MySQL_exec_raw(fridaDb, "ALTER TABLE auction_bot_characters ADD COLUMN persona_type varchar(32) DEFAULT 'material_merchant'");
            api_MySQL_exec_raw(fridaDb, "ALTER TABLE auction_bot_characters ADD COLUMN tags varchar(255) DEFAULT ''");
            api_MySQL_exec_raw(fridaDb, "ALTER TABLE auction_bot_characters ADD COLUMN activity_level decimal(4,2) DEFAULT 1.00");
            api_MySQL_exec_raw(fridaDb, "ALTER TABLE auction_bot_characters ADD COLUMN chat_enabled tinyint DEFAULT 0");

            // 插入默认配置
            var defaultConfigs = [
                ['sniping_enabled', '0', '狙击引擎开关'],
                ['listing_enabled', '0', '上架引擎开关'],
                ['bidding_enabled', '0', '竞价引擎开关'],
                ['restocking_enabled', '0', '补货引擎开关'],
                ['sniping_interval_s', '1200', '狙击扫描间隔(秒，最低900)'],
                ['listing_interval_s', '900', '上架间隔(秒，最低300)'],
                ['bidding_interval_s', '1800', '竞价间隔(秒，最低900)'],
                ['restocking_interval_s', '1800', '补货间隔(秒，最低900)'],
                ['sniping_price_ratio', '0.70', '收购价格比例'],
                ['listing_profit_margin', '1.30', '上架利润比例'],
                ['max_snipes_per_cycle', '5', '每轮最大收购数'],
                ['max_listings_per_cycle', '5', '每轮最大上架数'],
                ['max_bids_per_cycle', '5', '每轮最大竞价数'],
                ['max_restocks_per_cycle', '10', '每轮最大补货数'],
                ['price_randomization', '0.15', '价格随机化范围'],
                ['enable_behavior_sim', '1', '行为模拟开关'],
                ['mail_poll_interval_s', '60', '邮件轮询间隔(秒)']
            ];
            for (var d = 0; d < defaultConfigs.length; d++) {
                var dk = defaultConfigs[d][0];
                var dv = defaultConfigs[d][1];
                var dd = defaultConfigs[d][2];
                api_MySQL_exec_raw(fridaDb,
                    "INSERT IGNORE INTO auction_bot_config (config_key, config_value, description) VALUES ('" +
                    _escape(dk) + "', '" + _escape(dv) + "', '" + _escape(dd) + "')");
            }
            api.syncWhitelistProfiles();
            _ready = true;
        } else {
            log(WARN, '[auction] frida数据库暂不可用，5秒后重试表初始化');
            api_ScheduleOnMainThread_Delay(initFridaTables, [], 5000);
            return;
        }

        log(INFO, '[auction] 拍卖行数据库表初始化完成');
        };
        api_ScheduleOnMainThread(initFridaTables, []);

        log(INFO, '[auction] 拍卖行基础模块初始化完成');
    },

    api
};
