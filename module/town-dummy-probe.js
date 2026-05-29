/**
 * town-dummy-probe.js
 * 城镇假人投影协议探测模块
 *
 * 观测真实玩家进入 GameWorld 后的下行包，并承载一次性假人投影发包试验。
 *
 * 注意：reach_game_world 这个地址已经被 rank 模块先注册。项目的 hook registry
 * 支持同地址追加 attach 回调，但不会为追加回调打注册日志；把实验入口放在这里，
 * 可以和已证明触发的 capture start 使用同一个入口。
 */

var _config = {
    gmAuth: context.config.gmCid,
    captureWindowMs: 60000,
    maxPacketsPerWindow: 500,
    logPacketBytes: 24,
    logBinaryPreviewBytes: 96,
    logBinaryFullMaxBytes: 8192,
    traceAllHeaders: false,
    traceBuilderBacktrace: true,
    maxBuilderBacktracesPerHeader: 2,
    builderBacktraceDepth: 10,
    builderTraceHeaders: {
        '0:2': true,
        '0:21': true,
        '0:70': true,
        '0:339': true,
        '0:355': true,
        '0:561': true,
        '1:70': true
    },
    traceHeaders: {
        '0:2': true,
        '0:19': true,
        '0:21': true,
        '0:53': true,
        '0:70': true,
        '0:127': true,
        '0:205': true,
        '0:234': true,
        '0:300': true,
        '0:304': true,
        '0:339': true,
        '0:355': true,
        '0:357': true,
        '0:358': true,
        '0:411': true,
        '0:559': true,
        '0:561': true,
        '0:22': true,
        '0:23': true,
        '0:24': true,
        '1:70': true,
        '1:33': true,
        '1:356': true
    },
    maxTraceOps: 900
};

const { log } = context.main;
const { INFO, WARN, ERROR } = context.main.LOG_LEVELS;

const { getTimestamp } = context.system.time;
const { api_ScheduleOnMainThread_Delay } = context.system.thread;
const { strlen } = context.system.common;

const {
    CUserCharacInfo_GetCurCharacNo,
    api_CUserCharacInfo_GetCurCharacName,
    getUserPosition
} = context.utils.cuserCharacInfo;

const { api_CUser_SendNotiPacketMessage, CUser_Send } = context.utils.cuser;

const {
    api_PacketGuard_PacketGuard,
    InterfacePacketBuf_Put_Header,
    InterfacePacketBuf_Put_Byte,
    InterfacePacketBuf_Put_Short,
    InterfacePacketBuf_Put_Int,
    InterfacePacketBuf_Put_Str,
    InterfacePacketBuf_Finalize,
    Destroy_PacketGuard_PacketGuard
} = context.system.packet;

const auction = context.utils.auction;

var _captures = {};
var _packetMeta = {};
var _makeBasicInfoCalls = {};

function _nowMs() {
    return Date.now();
}

function _ptrKey(user) {
    return user ? user.toString() : '0';
}

function _readPacketHeader(packetGuard) {
    try {
        if (!packetGuard || packetGuard.isNull()) return null;

        var max = Math.max(8, _config.logPacketBytes || 24);
        var bytes = [];
        for (var i = 0; i < max; i++) {
            bytes.push(('0' + packetGuard.add(i).readU8().toString(16)).slice(-2));
        }
        return bytes.join(' ');
    } catch (e) {
        return 'read-failed:' + e;
    }
}

function _rememberPacketHeader(packetGuard, channel, header) {
    var key = _ptrKey(packetGuard);
    _packetMeta[key] = {
        channel: channel,
        header: header,
        created_ms: _nowMs(),
        finalized: false,
        ops: []
    };
}

function _markPacketFinalized(packetGuard, finalizeArg) {
    var meta = _packetMeta[_ptrKey(packetGuard)];
    if (!meta) return;
    meta.finalized = true;
    meta.finalize_arg = finalizeArg;
}

function _getPacketMeta(packetGuard) {
    var key = _ptrKey(packetGuard);
    var meta = _packetMeta[key] || null;

    // Keep the global guard map bounded; PacketGuard addresses are reused heavily.
    var now = _nowMs();
    var count = 0;
    for (var k in _packetMeta) {
        count++;
        if (now - _packetMeta[k].created_ms > 10000) delete _packetMeta[k];
    }
    if (count > 1000) _packetMeta = {};
    return meta;
}

function _shouldTraceMeta(meta) {
    if (!meta) return false;
    if (_config.traceAllHeaders) return true;
    return !!_config.traceHeaders[meta.channel + ':' + meta.header];
}

function _appendPacketOp(packetGuard, op) {
    var meta = _packetMeta[_ptrKey(packetGuard)];
    if (!_shouldTraceMeta(meta)) return;
    if (meta.ops.length >= _config.maxTraceOps) return;
    meta.ops.push(op);
}

function _hexBytes(ptrValue, len) {
    try {
        var out = [];
        for (var i = 0; i < len; i++) {
            out.push(('0' + ptrValue.add(i).readU8().toString(16)).slice(-2));
        }
        return out.join('');
    } catch (e) {
        return 'read-failed';
    }
}

function _previewBytes(ptrValue, len, maxLen) {
    try {
        var count = Math.min(len, maxLen || _config.logBinaryPreviewBytes || 96);
        var out = [];
        for (var i = 0; i < count; i++) {
            out.push(('0' + ptrValue.add(i).readU8().toString(16)).slice(-2));
        }
        return out.join('');
    } catch (e) {
        return 'read-failed';
    }
}

function _summarizeOps(meta) {
    if (!meta || !meta.ops || meta.ops.length === 0) return '';
    return ' ops=' + meta.ops.join('|');
}

function _readProbeTargetCharac() {
    try {
        if (!auction || !auction.isReady || !auction.isReady()) return 0;
        return parseInt(auction.getBotConfig('dummy_projection_probe_target_charac'), 10) || 0;
    } catch (e) {
        return 0;
    }
}

function _targetMarker(cap, meta) {
    if (!cap || !cap.target_charac_no || !meta || !meta.ops || meta.ops.length === 0) return '';

    // In header 0:2 B:0 captures, ops[3] is charac_no. In B:1 full snapshots it is
    // an internal/generated id, so this only marks the unambiguous small-basic case.
    if (meta.channel === 0 && meta.header === 2 && meta.ops.length > 3) {
        var op = meta.ops[3];
        if (op === ('I:' + cap.target_charac_no)) return ' TARGET_BASIC';
    }
    return '';
}

function _startCapture(user, reason) {
    var characNo = CUserCharacInfo_GetCurCharacNo(user);
    if (_config.gmAuth.indexOf(characNo) < 0) return;

    var pos = getUserPosition(user);
    var key = _ptrKey(user);
    _captures[key] = {
        user: user,
        charac_no: characNo,
        name: api_CUserCharacInfo_GetCurCharacName(user),
        reason: reason,
        start_ms: _nowMs(),
        count: 0,
        builder_counts: {},
        pos: pos,
        target_charac_no: _readProbeTargetCharac()
    };

    log(INFO, '[town-probe] capture start charac=' + characNo + ' name=' + _captures[key].name +
        ' reason=' + reason + ' target=' + _captures[key].target_charac_no +
        ' pos=' + JSON.stringify(pos) + ' at=' + getTimestamp());
}

function _maybeStartManualCapture(user) {
    if (!auction || !auction.isReady || !auction.isReady()) return;

    var armed = auction.getBotConfig('dummy_projection_probe_armed');
    var commandCapture = auction.getBotConfig('dummy_projection_command_capture');
    if (armed !== '1' && commandCapture !== '1') return;

    var characNo = CUserCharacInfo_GetCurCharacNo(user);
    if (_config.gmAuth.indexOf(characNo) < 0) return;

    if (commandCapture === '1') {
        auction.setBotConfig('dummy_projection_command_capture', '0', '一次性GM命令发包探测开关');
        _startCapture(user, 'manual_command_probe');
        api_CUser_SendNotiPacketMessage(user, 'GM命令发包探测已开始，请立即执行目标测试命令', 1);
        return;
    }

    auction.setBotConfig('dummy_projection_probe_armed', '0', '一次性城镇同屏建模探测开关');
    _startCapture(user, 'manual_same_screen_probe');
    api_CUser_SendNotiPacketMessage(user, '同屏建模探测已开始，请让另一个角色小退重进或走进同屏', 1);
}

function _hasActiveCapture() {
    var now = _nowMs();
    for (var key in _captures) {
        var cap = _captures[key];
        if (cap && now - cap.start_ms <= _config.captureWindowMs) return true;
    }
    return false;
}

function _formatBacktrace(contextValue) {
    try {
        var frames = Thread.backtrace(contextValue, Backtracer.ACCURATE)
            .slice(0, _config.builderBacktraceDepth || 10);
        var parts = [];
        for (var i = 0; i < frames.length; i++) {
            var addr = frames[i];
            var symbol = '';
            try {
                symbol = DebugSymbol.fromAddress(addr).toString();
            } catch (e) {
                symbol = addr.toString();
            }
            parts.push(symbol);
        }
        return parts.join(' <- ');
    } catch (e) {
        return 'backtrace-failed:' + e;
    }
}

function _recordBuilderBacktrace(channel, header, contextValue) {
    if (!_config.traceBuilderBacktrace) return;

    var packetKey = channel + ':' + header;
    if (!_config.builderTraceHeaders[packetKey]) return;
    if (!_hasActiveCapture()) return;

    var now = _nowMs();
    for (var key in _captures) {
        var cap = _captures[key];
        if (!cap || now - cap.start_ms > _config.captureWindowMs) continue;

        var count = cap.builder_counts[packetKey] || 0;
        if (count >= (_config.maxBuilderBacktracesPerHeader || 2)) continue;
        cap.builder_counts[packetKey] = count + 1;

        log(INFO, '[town-probe] builder-bt charac=' + cap.charac_no +
            ' elapsed_ms=' + (now - cap.start_ms) +
            ' header=' + packetKey + ' index=' + (count + 1) +
            ' bt=' + _formatBacktrace(contextValue));
    }
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
        log(INFO, '[town-probe] dummy town list test packet sent charac_no=' + dummy.charac_no +
            ' name=' + dummy.charac_name + ' area=' + dummy.area + ' x=' + dummy.x + ' y=' + dummy.y);
        return true;
    } finally {
        Destroy_PacketGuard_PacketGuard(packetGuard);
    }
}

function _sendArmedDummyProjectionTest(user) {
    if (!auction || !auction.isReady || !auction.isReady()) {
        log(WARN, '[town-probe] armed dummy projection skipped: auction db not ready');
        return;
    }

    var armed = auction.getBotConfig('dummy_projection_test_armed');
    if (armed !== '1') {
        log(INFO, '[town-probe] armed dummy projection skipped: not armed value=' + armed);
        return;
    }

    var characNo = CUserCharacInfo_GetCurCharacNo(user);
    if (_config.gmAuth.indexOf(characNo) < 0) {
        log(INFO, '[town-probe] armed dummy projection skipped: charac_no=' + characNo + ' not gm');
        return;
    }

    auction.setBotConfig('dummy_projection_test_armed', '0', '一次性进入世界站街投影测试开关');
    var rows = auction.getProjectedBotCharacters(1);
    if (!rows || rows.length === 0) {
        log(WARN, '[town-probe] armed dummy projection skipped: no projected dummies');
        api_CUser_SendNotiPacketMessage(user, '暂无已分配的投影假人，请先 //au dummy assign 500', 8);
        return;
    }

    try {
        _sendDummyTownListTestPacket(user, rows[0]);
        api_CUser_SendNotiPacketMessage(user,
            '已在进入世界窗口下发1个站街测试包: ' + rows[0].charac_name + '#' + rows[0].charac_no, 1);
    } catch (e) {
        log(ERROR, '[town-probe] armed dummy projection test failed: ' + (e && e.stack ? e.stack : e));
        api_CUser_SendNotiPacketMessage(user, '进入世界站街测试包发送失败，请看frida日志', 8);
    }
}

function _recordPacket(user, packetGuard) {
    _maybeStartManualCapture(user);

    var key = _ptrKey(user);
    var cap = _captures[key];
    if (!cap) return;

    var elapsed = _nowMs() - cap.start_ms;
    if (elapsed > _config.captureWindowMs || cap.count >= _config.maxPacketsPerWindow) {
        log(INFO, '[town-probe] capture end charac=' + cap.charac_no + ' packets=' + cap.count + ' elapsed_ms=' + elapsed);
        delete _captures[key];
        return;
    }

    cap.count++;
    var meta = _getPacketMeta(packetGuard);
    var metaText = meta
        ? (' channel=' + meta.channel + ' header=' + meta.header + ' finalized=' + (meta.finalized ? 1 : 0) + ' finalize_arg=' + (meta.finalize_arg || 0))
        : ' channel=? header=?';
    log(INFO, '[town-probe] packet #' + cap.count + ' charac=' + cap.charac_no +
        ' elapsed_ms=' + elapsed + ' guard=' + packetGuard + metaText + _summarizeOps(meta) +
        _targetMarker(cap, meta) + ' bytes=' + _readPacketHeader(packetGuard));
}

function _recordSendPacket(user, packetId, packetPtr) {
    var key = _ptrKey(user);
    var cap = _captures[key];
    if (!cap) return;

    var elapsed = _nowMs() - cap.start_ms;
    if (elapsed > _config.captureWindowMs) return;

    log(INFO, '[town-probe] sendPacket charac=' + cap.charac_no +
        ' elapsed_ms=' + elapsed + ' packet_id=' + packetId + ' packet=' + packetPtr);
}

function _recordGetUserInfo(user, a2, a3) {
    _maybeStartManualCapture(user);

    var key = _ptrKey(user);
    var cap = _captures[key];
    if (!cap) return;

    var elapsed = _nowMs() - cap.start_ms;
    if (elapsed > _config.captureWindowMs) return;

    log(INFO, '[town-probe] get_user_info charac=' + cap.charac_no +
        ' elapsed_ms=' + elapsed +
        ' arg2=' + a2 + ' arg3=' + a3 +
        ' bt=' + _formatBacktrace(this && this.context ? this.context : null));
}

function _recordMakeBasicInfoEnter(sourceUser, packetGuard, mode) {
    if (!_hasActiveCapture()) return null;

    var sourceCharacNo = 0;
    try {
        sourceCharacNo = CUserCharacInfo_GetCurCharacNo(sourceUser);
    } catch (e) {
        sourceCharacNo = 0;
    }

    var call = {
        source_user: sourceUser,
        source_charac_no: sourceCharacNo,
        packet_guard: packetGuard,
        mode: mode,
        start_ms: _nowMs()
    };
    _makeBasicInfoCalls[_ptrKey(packetGuard)] = call;

    log(INFO, '[town-probe] make_basic_info enter source_user=' + sourceUser +
        ' source_charac=' + sourceCharacNo +
        ' packet=' + packetGuard +
        ' mode=' + mode +
        ' bt=' + _formatBacktrace(this && this.context ? this.context : null));
    return call;
}

function _recordMakeBasicInfoLeave(call, retval) {
    if (!call) return;

    var meta = _getPacketMeta(call.packet_guard);
    var elapsed = _nowMs() - call.start_ms;
    log(INFO, '[town-probe] make_basic_info leave source_user=' + call.source_user +
        ' source_charac=' + call.source_charac_no +
        ' packet=' + call.packet_guard +
        ' mode=' + call.mode +
        ' ret=' + retval +
        ' elapsed_ms=' + elapsed +
        (meta ? (' channel=' + meta.channel + ' header=' + meta.header +
            ' finalized=' + (meta.finalized ? 1 : 0) +
            ' finalize_arg=' + (meta.finalize_arg || 0)) : ' channel=? header=?') +
        _summarizeOps(meta));

    delete _makeBasicInfoCalls[_ptrKey(call.packet_guard)];
}

module.exports = {
    init() {
        log(INFO, '[town-probe] 城镇假人协议探测模块已启用，记录GM进入GameWorld后的下行包，并执行一次性假人投影试验，BIN预览=' + _config.logBinaryPreviewBytes + '字节');
    },

    dispose() {
        _captures = {};
        log(INFO, '[town-probe] 城镇假人协议探测模块已停止');
    },

    hooks: [
        {
            // GameWorld::reach_game_world
            address: '0x86C4E50',
            onEnter(args) {
                this.user = args[1];
            },
            onLeave(retval) {
                if (this.user) {
                    _startCapture(this.user, 'reach_game_world');
                    log(INFO, '[town-probe] armed dummy projection check scheduled after reach_game_world user=' + this.user);
                    api_ScheduleOnMainThread_Delay(_sendArmedDummyProjectionTest, [this.user], 1300);
                }
            }
        },
        {
            // InterfacePacketBuf::Put_Header(PacketGuard*, channel, header)
            address: '0x80CB8FC',
            onEnter(args) {
                var channel = args[1].toInt32();
                var header = args[2].toInt32();
                _rememberPacketHeader(args[0], channel, header);
                _recordBuilderBacktrace(channel, header, this.context);
            }
        },
        {
            // InterfacePacketBuf::Finalize(PacketGuard*, arg)
            address: '0x80CB958',
            onEnter(args) {
                _markPacketFinalized(args[0], args[1].toInt32());
            }
        },
        {
            // InterfacePacketBuf::Put_Byte(PacketGuard*, uint8)
            address: '0x80CB920',
            onEnter(args) {
                _appendPacketOp(args[0], 'B:' + (args[1].toInt32() & 0xff));
            }
        },
        {
            // InterfacePacketBuf::Put_Short(PacketGuard*, uint16)
            address: '0x80D9EA4',
            onEnter(args) {
                _appendPacketOp(args[0], 'S:' + (args[1].toInt32() & 0xffff));
            }
        },
        {
            // InterfacePacketBuf::Put_Int(PacketGuard*, int)
            address: '0x80CB93C',
            onEnter(args) {
                _appendPacketOp(args[0], 'I:' + args[1].toInt32());
            }
        },
        {
            // InterfacePacketBuf::Put_Str(PacketGuard*, ptr, len)
            address: '0x081B73E4',
            onEnter(args) {
                var len = args[2].toInt32();
                var preview = '';
                try {
                    if (len > 0 && len <= 64) preview = ':' + args[1].readUtf8String(len);
                } catch (e) {
                    preview = ':read-failed';
                }
                _appendPacketOp(args[0], 'STR:' + len + preview);
            }
        },
        {
            // InterfacePacketBuf::Put_Binary(PacketGuard*, ptr, len)
            address: '0x811DF08',
            onEnter(args) {
                var len = args[2].toInt32();
                var meta = _packetMeta[_ptrKey(args[0])];
                if (_shouldTraceMeta(meta)) {
                    _appendPacketOp(args[0], 'BIN:' + len + ':' + _previewBytes(args[1], len, _config.logBinaryPreviewBytes));
                    if (meta && meta.channel === 0 && meta.header === 561 && len > 0 && len <= _config.logBinaryFullMaxBytes && _hasActiveCapture()) {
                        log(INFO, '[town-probe] binary-full header=0:561 len=' + len + ' hex=' + _hexBytes(args[1], len));
                    }
                }
            }
        },
        {
            // CUser::Send(PacketGuard*)
            address: '0x86485BA',
            onEnter(args) {
                _recordPacket(args[0], args[1]);
            }
        },
        {
            // CUser::SendPacket(int, Packet*)
            address: '0x867B8FE',
            onEnter(args) {
                _recordSendPacket(args[0], args[1].toInt32(), args[2]);
            }
        },
        {
            // CUser::make_basic_info(PacketGuard*, mode)
            address: '0x865A44E',
            onEnter(args) {
                this.makeBasicInfoCall = _recordMakeBasicInfoEnter.call(this, args[0], args[1], args[2].toInt32());
            },
            onLeave(retval) {
                _recordMakeBasicInfoLeave(this.makeBasicInfoCall, retval.toInt32());
            }
        },
        {
            // GameWorld::get_user_info(CUser*, int, int)
            address: '0x86CAD68',
            onEnter(args) {
                _recordGetUserInfo.call(this, args[1], args[2].toInt32(), args[3].toInt32());
            }
        }
    ]
};
