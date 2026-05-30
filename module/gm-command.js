/**
 * gm-command.js
 * GM指令，通过下方 模块配置 中的 cmd 触发响应功能
 * 20250901 by Tim
 */

/** 模块配置 */
var _config = {
    gmAuth: context.config.gmCid,//权限认证采用全局配置文件中的
    cmd: {
        '全服消息命令': 'notice',   //例：//notice 这是消息
        '全服公告命令': 'alert',    //例：//alert 这是公告
        '踢人命令': 'kick',         //例：//kick 张三

        '获取物品命令': 'item',     //例：//item 3340 100
        '增加经验命令': 'exp',      //例：//exp 1000000
        '调整等级命令': 'lv',       //例：//lv 70          （注意最大只能70级且调到70级会闪退）

        '完成任务命令': 'rwwc',     //例：//rwwc            (完成全部已结任务，只领取不需要选择的任务奖励)
        '解锁王图命令': 'unlkdgn',  //例：//unlkdgn
        '副本信息命令': 'dgninfo',  //例：//dgninfo
        '用户位置命令': 'pos',      //例：//pos            (获取用户位置，不包括PVP)

        '重新初始化命令': 'reinit',   //例：//reinit      (重新初始化除了会重新读取配置文件，还会根据配置文件重新加载基础模块)
        '重新加载模块命令': 'reload', //例：//reload [cfg|moduleName] 
        //reload moduleName cfg
    }
}

////////////////////////////////////////////////////////////////////////
// 接口
////////////////////////////////////////////////////////////////////////

const { log } = context.main;
const { INFO, WARN, ERROR } = context.main.LOG_LEVELS;

const { getAccIdByCharacName } = context.mysql.gameService;

const { api_PacketBuf_Get_Buf } = context.system.packet;

const { api_GameWorld_Find_User_From_World_ByAccid,
    api_GameWorld_SendNotiPacketMessage,
    api_GameWorld_SendAlertPacketMessage } = context.utils.gameWorld;

// const { api_CGameManager_GetUserByAccId } = context.utils.gameCGameManager;

const { UPDATE_TYPE_INVENTORY,
    UPDATE_TYPE_AVATAR,
    UPDATE_TYPE_CREATURE,
    UPDATE_TYPE_BODY } = context.utils.cuser.UPDATE_TYPE;
const { CUser_GetCurCharacQuestW,
    CUser_Quest_Action,
    CUser_SetGmQuestFlag,
    CUser_Get_State,
    CUser_Send_Clear_Quest_List,
    CUser_SendCharacQp,
    CUser_SendCharacQuestPiece,

    CUser_SendUpdateItemList,
    CUser_SendNotiPacket,

    setGameMasterModeTemp,
    getUserPosition,

    api_DoUserDefineCommand_Unlock_Dungeon,
    api_CUser_Kill_The_Game,
    api_CUser_AddItem,
    api_CUser_Gain_Exp_Sp,
    api_CUser_Send_Updata_Quest_Info,
    api_CUser_SendNotiPacketMessage } = context.utils.cuser;

const { CUserCharacInfo_GetCurCharacNo } = context.utils.cuserCharacInfo;

const { CDungeon_GetDungeonIdxAfterClear, api_CDungeon_GetDungeonName } = context.utils.cdungeon;


/** 设置角色等级(最高70级)*/
var DisPatcher_DebugCommand__DebugCommandSetLevel = new NativeFunction(ptr(0x0858EFDE), 'int', ['pointer', 'pointer', 'int'], { "abi": "sysv" });//需要临时开GM权限

////////////////////////////////////////////////////////////////////////
// 变量 
////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////
// 函数
////////////////////////////////////////////////////////////////////////

/** 
 * 设置角色等级(最高70级)
 * @param {*} user 
 * @param {*} new_level 
 */
function api_DisPatcher_DebugCommand__DebugCommandSetLevel(user, new_level) {
    // 为该角色临时开通GM权限
    var old_gm_mode = setGameMasterModeTemp(user, 1);

    DisPatcher_DebugCommand__DebugCommandSetLevel(ptr(0), user, new_level);

    // 恢复原始GM权限
    setGameMasterModeTemp(user, old_gm_mode);
}

/** 
 * 无条件完成指定任务并领取奖励
*/
function _clearUserQuestById(user, quest_id) {
    // 设置GM完成任务模式(无条件完成任务)
    CUser_SetGmQuestFlag(user, 1);

    // 接受任务
    CUser_Quest_Action(user, 33, quest_id, 0, 0);

    // 完成任务
    CUser_Quest_Action(user, 35, quest_id, 0, 0);

    // 领取任务奖励(倒数第二个参数表示领取奖励的编号, -1=领取不需要选择的奖励; 0=领取可选奖励中的第1个奖励; 1=领取可选奖励中的第二个奖励)
    CUser_Quest_Action(user, 36, quest_id, -1, 1);

    // 服务端有反作弊机制: 任务完成时间间隔不能小于1秒.  这里将上次任务完成时间清零 可以连续提交任务
    user.add(0x79644).writeInt(0);

    // 关闭GM完成任务模式(不需要材料直接完成)
    CUser_SetGmQuestFlag(user, 0);

    return;
}

/** 
 * 完成当前已接任务并领取奖励
*/
function _clearUserQuestList(user) {
    // 玩家任务信息
    var user_quest = CUser_GetCurCharacQuestW(user);

    // 遍历20个已接任务
    // 任务列表(保存任务id): user_quest.add(4 * (i + 7500 + 2))
    // 任务完成状态(0=已满足任务条件): user_quest.add(4 * (i + 7520 + 2))
    for (var i = 0; i < 20; i++) {
        // 任务id
        var quest_id = user_quest.add(4 * (i + 7500 + 2)).readInt();

        if (quest_id > 0) {
            // 无条件完成任务并领取奖励
            _clearUserQuestById(user, quest_id);
        }
    }

    // 通知客户端更新已完成任务列表
    CUser_Send_Clear_Quest_List(user);

    // 通知客户端更新任务列表
    api_CUser_Send_Updata_Quest_Info(user);
}

/**
 * 处理GM指令
 */
function _handleGmCommand(user, msg) {

    // 重新初始化(重新读取配置文件、utils模块)
    if (msg == _config.cmd['重新初始化命令']) {
        context.main.module.reinit();
        api_CUser_SendNotiPacketMessage(user, '已重新初始化！', 8);
        return;
    }

    // 判断模块相关
    if (msg.indexOf(_config.cmd['重新加载模块命令']) == 0) {
        var params = msg.split(' ');
        let result = false;
        let message = '';//消息

        switch (params.length) {
            case 1: // reload
                result = context.main.module.reload();
                message = result ? '已重新加载全部模块！' : '部分模块可能卸载失败，请查看日志！';
                break;
            case 2: // reload [cfg|moduleName]
                if (params[1] === 'cfg') {
                    context.main.module.reinit();
                    result = context.main.module.reload();
                    message = result ? '已更新配置并重载全部模块！' : '部分模块可能卸载失败，请查看日志！';
                } else {
                    result = context.main.module.reload(params[1]);
                    message = result ? `已重新加载 [${params[1]}] 模块！` : `模块 [${params[1]}] 不存在或未启用！`;
                }
                break;
            case 3: // reload moduleName cfg
                if (params[2] === 'cfg') {
                    context.main.module.reinit();
                    result = context.main.module.reload(params[1]);
                    message = result ? `已更新配置并重载 [${params[1]}] 模块！` : `模块 [${params[1]}] 不存在或未启用！`;
                } else {
                    message = '无效的 reload 命令格式！';
                }
                break;
            default:
                message = '无效的 reload 命令！';
        }
        api_CUser_SendNotiPacketMessage(user, message, 8);
        return;
    }

    //具体功能
    if (msg.indexOf(_config.cmd['全服消息命令']) == 0) {
        let msg_group = msg = msg.split(' ');
        if (msg_group.length < 2) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 命令格式错误: //命令 消息内容', 8);
            return;
        }
        msg = msg_group[1];
        api_GameWorld_SendNotiPacketMessage(msg, 14);
        // 向客户端发送消息
        api_CUser_SendNotiPacketMessage(user, 'GM: 消息发送成功！', 1);
        return;
    }

    if (msg.indexOf(_config.cmd['全服公告命令']) == 0) {
        let msg_group = msg = msg.split(' ');
        if (msg_group.length < 2) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 命令格式错误: //命令 消息内容', 8);
            return;
        }
        msg = msg_group[1];
        api_GameWorld_SendAlertPacketMessage(user, msg, 0);//弹窗
        api_GameWorld_SendNotiPacketMessage(msg, 14);//公告
        api_CUser_SendNotiPacketMessage(user, 'GM: 公告发送成功！', 1);
        return;
    }

    if (msg.indexOf(_config.cmd['获取物品命令']) == 0) {
        var msg_group = msg.split(' ');
        if (msg_group.length < 3) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 命令格式错误: //命令 物品id 数量', 8);
            return;
        }
        var item_id = parseInt(msg_group[1]);
        var item_cnt = parseInt(msg_group[2]);
        // 发送道具到玩家背包
        api_CUser_AddItem(user, item_id, item_cnt);
        api_CUser_SendNotiPacketMessage(user, 'GM: 物品发送成！', 1);
        return;
    }

    if (msg.indexOf(_config.cmd['增加经验命令']) == 0) {
        var msg_group = msg.split(' ');
        if (msg_group.length < 2) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 格式错误: //命令 经验值', 8);
            return;
        }
        api_CUser_Gain_Exp_Sp(user, parseInt(msg_group[1]));
        // 通知客户端更新奖励数据
        if (CUser_Get_State(user) == 3) {
            CUser_SendNotiPacket(user, 0, 2, 0);
            CUser_SendNotiPacket(user, 1, 2, 1);
            CUser_SendUpdateItemList(user, 1, UPDATE_TYPE_INVENTORY, 0);
            CUser_SendCharacQp(user);
            CUser_SendCharacQuestPiece(user);
        }
        api_CUser_SendNotiPacketMessage(user, 'GM: 经验已发放！', 1);
        return;
    }

    if (msg.indexOf(_config.cmd['调整等级命令']) == 0) {
        var msg_group = msg.split(' ')
        if (msg_group.length < 2) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 格式错误: //命令 等级', 8);
            return;
        }
        api_DisPatcher_DebugCommand__DebugCommandSetLevel(user, parseInt(msg_group[1]));
        api_CUser_SendNotiPacketMessage(user, 'GM: 等级已调整！', 1);
        return;
    }

    if (msg.indexOf(_config.cmd['踢人命令']) == 0) {
        var msg_group = msg.split(' ')
        if (msg_group.length < 2) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 格式错误: //命令 角色名', 8);
            return;
        }
        var accountId = getAccIdByCharacName(msg_group[1]);
        if (!accountId) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 未找到账号ID， 请确认角色名！', 8);
            return;
        }
        var targetUser = api_GameWorld_Find_User_From_World_ByAccid(accountId);
        if (!targetUser) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 未找到玩家， 请确认角色名！', 8);
            return;
        }
        if (CUser_Get_State(targetUser) < 3) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 当前角色未登录！', 8);
            return;
        }
        api_CUser_Kill_The_Game(targetUser);
        api_CUser_SendNotiPacketMessage(user, `GM: ${msg_group[1]} 已踢出！`, 1);
        return;
    }

    if (msg == _config.cmd['完成任务命令']) {
        _clearUserQuestList(user);
        api_CUser_SendNotiPacketMessage(user, 'GM: 已完成全部已结任务！', 1);
        return;
    }

    if (msg == _config.cmd['解锁王图命令']) {
        api_DoUserDefineCommand_Unlock_Dungeon(user);
        api_CUser_SendNotiPacketMessage(user, 'GM: 全副本王图已开， 小退后生效！', 1);
        return;
    }

    if (msg == _config.cmd['用户位置命令']) {
        var pos = getUserPosition(user);
        if (!pos) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 位置信息获取失败!', 8);
            return;
        }
        api_CUser_SendNotiPacketMessage(user, 'GM: 位置信息 -', 1);
        api_CUser_SendNotiPacketMessage(user, '\t\t\t\tX坐标: ' + pos.x, 1);
        api_CUser_SendNotiPacketMessage(user, '\t\t\t\tY坐标: ' + pos.y, 1);
        api_CUser_SendNotiPacketMessage(user, '\t\t\t\t城镇编号: ' + pos.village, 1);
        api_CUser_SendNotiPacketMessage(user, '\t\t\t\t区域编号: ' + pos.area, 1);
        return;
    }

    if (msg == _config.cmd['副本信息命令']) {
        var dgnid = CDungeon_GetDungeonIdxAfterClear(user);
        if (!dgnid) {
            api_CUser_SendNotiPacketMessage(user, 'GM: 请在副本中使用!', 8);
            return;
        }
        var dngName = api_CDungeon_GetDungeonName(dgnid);
        api_CUser_SendNotiPacketMessage(user, 'GM: 副本信息 -', 1);
        api_CUser_SendNotiPacketMessage(user, '\t\t\t\tID: ' + dgnid, 1);
        api_CUser_SendNotiPacketMessage(user, '\t\t\t\tName: ' + dngName, 1);
        return;
    }
    return;
}

////////////////////////////////////////////////////////////////////////
//导出
////////////////////////////////////////////////////////////////////////

module.exports = {
    hooks: [
        // GM指令
        {
            address: '0x820BBDE',
            onEnter(args) {
                // 用户信息
                var user = args[1];
                var charac_no = CUserCharacInfo_GetCurCharacNo(user);
                if (!_config.gmAuth.includes(charac_no))
                    return;

                // 获取原始封包数据
                var rawPacketBuf = api_PacketBuf_Get_Buf(args[2]);
                // 解析GM DEBUG命令
                var msgLen = rawPacketBuf.readS32();
                var msg = rawPacketBuf.add(4).readUtf8String(msgLen);
                msg = msg.slice(2);
                msg = msg.trim();
                _handleGmCommand(user, msg);
            },
            onLeave(retval) {

            }
        }
    ]
};
