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
    snipingInterval: 30,
    listingInterval: 120,
    biddingInterval: 90,
    restockingInterval: 300,
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
const { get_rand_int } = context.system.common;

const { CUserCharacInfo_GetCurCharacNo } = context.utils.cuserCharacInfo;
const { api_CUser_SendNotiPacketMessage } = context.utils.cuser;
const { api_PacketBuf_Get_Buf } = context.system.packet;

// 拍卖行API
const auction = context.utils.auction;

////////////////////////////////////////////////////////////////////////
// 变量
////////////////////////////////////////////////////////////////////////

var _running = false;
var _engines = {};
var _lastPriceSnapshot = 0;
var _lastMailPoll = 0;

////////////////////////////////////////////////////////////////////////
// 函数 - 工具
////////////////////////////////////////////////////////////////////////

/** 获取DB配置（带默认值回退） */
function _getConfigInt(key, defaultVal) {
    var val = auction.getBotConfig(key);
    return val !== null ? parseInt(val, 10) : defaultVal;
}

function _getConfigFloat(key, defaultVal) {
    var val = auction.getBotConfig(key);
    return val !== null ? parseFloat(val) : defaultVal;
}

function _getConfigBool(key, defaultVal) {
    var val = auction.getBotConfig(key);
    if (val === null) return defaultVal;
    return val === '1' || val === 'true';
}

function _floorInt(value, floor) {
    value = parseInt(value, 10) || floor;
    return value < floor ? floor : value;
}

/** 从DB刷新配置 */
function _reloadConfig() {
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
    } catch (e) {
        log(WARN, '[auction-bot] 配置加载失败，使用默认关闭状态: ' + e);
        _engines.sniper.enabled = false;
        _engines.lister.enabled = false;
        _engines.bidder.enabled = false;
        _engines.restocker.enabled = false;
    }

    _engines.sniper.interval = _config.snipingInterval;
    _engines.lister.interval = _config.listingInterval;
    _engines.bidder.interval = _config.biddingInterval;
    _engines.restocker.interval = _config.restockingInterval;
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
            if (profiles[i].category === 'equipment' || profiles[i].category === 'rare') {
                profiles[i].endurance = 35;
                profiles[i].seal_flag = 1;
            } else {
                profiles[i].endurance = 0;
                profiles[i].seal_flag = 0;
            }
        }
        return profiles;
    }
    return auction.getWhitelistItems();
}

function _pickListingQuantity(profile) {
    var min = profile.preferred_stack_min || 1;
    var max = profile.preferred_stack_max || profile.stack_size || 1;
    if (max < min) max = min;
    return min + Math.floor(Math.random() * (max - min + 1));
}

function _sendLines(user, lines, color) {
    for (var i = 0; i < lines.length; i++) {
        api_CUser_SendNotiPacketMessage(user, lines[i], color || 3);
    }
}

function _nowSec() {
    return api_CSystemTime_getCurSec();
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
                " AND a.expire_time > " + _nowSec() + " LIMIT " + (maxSnipes - sniped);

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

        var seller = auction.getSystemSeller();
        if (!seller) return;

        var maxRestocks = Math.floor(_config.maxRestocksPerCycle * _activityMultiplier());
        var totalRestocked = 0;

        for (var w = 0; w < whitelist.length && totalRestocked < maxRestocks; w++) {
            var wl = whitelist[w];
            var stackSize = wl.stack_size || 1;
            var targetRecords = wl.max_listings || Math.ceil(wl.quantity / stackSize);
            var targetQuantity = wl.min_total_quantity || wl.quantity || stackSize;

            // 查询当前系统在售数量
            var auctionDb = auction.getAuctionDb();
            if (!auctionDb) continue;

            var sql = "SELECT COUNT(*), COALESCE(SUM(add_info),0) FROM auction_main WHERE item_id = " + wl.item_id + " AND owner_type = " + seller.owner_type + " AND expire_time > " + _nowSec();
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
                var pos = current + i;
                var addInfo = _pickListingQuantity(wl);
                if (pos >= targetRecords - 1) {
                    // 最后一条可能不满堆
                    addInfo = Math.max(1, wl.quantity - (targetRecords - 1) * stackSize);
                }

                var basePrice = auction.calculateMarketPrice(wl.system_price, wl.item_id);
                var unitPrice = Math.floor(basePrice * _config.listingProfitMargin);
                unitPrice = _randomizePrice(unitPrice);

                var listing = {
                    owner_id: seller.owner_id,
                    owner_name: seller.owner_name,
                    owner_type: seller.owner_type,
                    owner_nexon_id: seller.owner_nexon_id,
                    item_id: wl.item_id,
                    unit_price: unitPrice,
                    add_info: addInfo,
                    upgrade: wl.upgrade || 0,
                    endurance: wl.endurance != null ? wl.endurance : 35,
                    seal_flag: wl.seal_flag != null ? wl.seal_flag : 1
                };

                if (auction.listAuctionItem(listing)) {
                    auction.logOperation('restock', wl.item_id, 0, seller.owner_id, 0, unitPrice, addInfo,
                        '补货: ' + (wl.cname || wl.item_id) + ' x' + addInfo + ' @ ' + unitPrice);
                    auction.logEconomyEvent({
                        event_type: 'restock',
                        source: 'plugin',
                        actor_type: 'system',
                        actor_id: seller.owner_id,
                        counterparty_type: 'market',
                        counterparty_id: 0,
                        item_id: wl.item_id,
                        quantity: addInfo,
                        unit_price: unitPrice,
                        total_price: unitPrice * addInfo,
                        gold_delta: 0,
                        item_delta: addInfo,
                        reason: '系统补货'
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
                owner_name: ch.charac_name,
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
                " AND expire_time > " + _nowSec() + " AND expire_time < " + (_nowSec() + 2 * 3600) +
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
    msg = (msg || '').replace(/\s+/g, ' ').trim();
    var parts = msg ? msg.split(' ') : [];
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
            api_CUser_SendNotiPacketMessage(user, '补货引擎已开启', 1);
        } else if (sub === 'off') {
            _engines.restocker.enabled = false;
            auction.setBotConfig('restocking_enabled', '0', '补货引擎开关');
            api_CUser_SendNotiPacketMessage(user, '补货引擎已关闭', 8);
        } else if (sub === 'now') {
            api_CUser_SendNotiPacketMessage(user, '正在执行补货...', 3);
            _engines.restocker.tick();
            api_CUser_SendNotiPacketMessage(user, '补货完成', 1);
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
        var itemIdStr = cmd === 'au' ? parts[3] : sub;
        if (cmd === 'au') itemIdStr = parts[3];
        if (!itemIdStr) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au stats <物品ID>', 8);
            return;
        }
        var itemId = parseInt(itemIdStr, 10);
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
        var marketItemId = cmd === 'au' ? parts[3] : sub;
        if (!marketItemId) {
            api_CUser_SendNotiPacketMessage(user, '格式: //au market <物品ID>', 8);
            return;
        }
        var mid = parseInt(marketItemId, 10);
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
        var ledgerArg = cmd === 'au' ? parts[3] : arg;
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

        // 从DB加载配置
        _reloadConfig();

        // 启动定时器
        _running = true;
        _lastMailPoll = api_CSystemTime_getCurSec();
        _lastPriceSnapshot = api_CSystemTime_getCurSec();
        _engines.sniper.lastRun = api_CSystemTime_getCurSec();
        _engines.lister.lastRun = api_CSystemTime_getCurSec();
        _engines.bidder.lastRun = api_CSystemTime_getCurSec();
        _engines.restocker.lastRun = api_CSystemTime_getCurSec();

        // MVP安全模式：初始化阶段不自动启动后台循环，避免阻塞登录流程。
        // 使用 //au reload 后可手工触发各引擎的 now 命令验证单次行为。
        if (auction.getBotConfig('timer_autostart_enabled') === '1') {
            api_ScheduleOnMainThread_Delay(_timerTick, [], 5000);
        }

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
        }
    ]
};
