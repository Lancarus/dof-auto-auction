/**
 * extend-cuser.js
 * cuser 相关模块（拓展模块）
 */

////////////////////////////////////////////////////////////////////////
// 接口
////////////////////////////////////////////////////////////////////////

const { log } = context.main;
const { INFO, WARN, ERROR } = context.main.LOG_LEVELS;

const { InterfacePacketBuf_Put_Header,
    InterfacePacketBuf_Put_Byte,
    InterfacePacketBuf_Put_Short,
    InterfacePacketBuf_Put_Int,
    InterfacePacketBuf_Put_Str,
    InterfacePacketBuf_Put_Binary,
    InterfacePacketBuf_Finalize,

    Destroy_PacketGuard_PacketGuard,
    api_PacketGuard_PacketGuard, } = context.system.packet;

const { strlen,get_rand_int } = context.system.common;

const { api_Get_Jewel_Socket_Data } = context.mysql.fridaService;

const { UPDATE_TYPE_INVENTORY,
    UPDATE_TYPE_AVATAR,
    UPDATE_TYPE_CREATURE,
    UPDATE_TYPE_BODY } = context.utils.cuser.UPDATE_TYPE;
const { CUser_Send,
    CUser_SendPacket,
    CUser_SendUpdateItemList } = context.utils.cuser;

const { CUserCharacInfo_GetCurCharacInvenW } = context.utils.cuserCharacInfo;

const { INVENTORY_TYPE_BODY,
    INVENTORY_TYPE_ITEM,
    INVENTORY_TYPE_AVARTAR,
    INVENTORY_TYPE_CREATURE } = context.utils.cinven.INVENTORY_TYPE;

const { Inven_Item_GetKey,
    Inven_Item_IsEquipableItemType,
    CInventory_GetInvenRef,
    CInventory_Delete_Item,
    CInventory_MakeItemPacket } = context.utils.cinven;

const { api_CItem_GetItemName,
    CItem_Is_Stackable } = context.utils.citem;

const { CEquipItem_Get_Endurance } = context.utils.cequipItem;

const { api_CDataManager_Find_Item } = context.utils.cdataManager;

 
////////////////////////////////////////////////////////////////////////
// 变量 
////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////
// 函数
////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////
// 导出
////////////////////////////////////////////////////////////////////////

const api = {
    /** 刷新带镶嵌装备 */
    CUser_SendUpdateEqu_JewelSocket(CUser, Slot) {
        var v4 = CUserCharacInfo_GetCurCharacInvenW(CUser);
        var equipment = CInventory_GetInvenRef(v4, INVENTORY_TYPE_ITEM, Slot);
        if (Inven_Item_IsEquipableItemType(equipment))//判断是否是装备
        {
            var id = equipment.add(25).readU32();
            var JewelSocketData = Memory.alloc(30);//空字节数据
            JewelSocketData = api_Get_Jewel_Socket_Data(id)//取出原有的孔位以及徽章数据

            if (JewelSocketData && !JewelSocketData.isNull()) {//如果有镶嵌则发送镶嵌数据
                var v10 = api_PacketGuard_PacketGuard();
                try {
                    InterfacePacketBuf_Put_Header(v10, 0, 14);
                    InterfacePacketBuf_Put_Byte(v10, 0);
                    InterfacePacketBuf_Put_Short(v10, 1);
                    CInventory_MakeItemPacket(v4, 1, Slot, v10);
                    InterfacePacketBuf_Put_Binary(v10, JewelSocketData, 30);
                    InterfacePacketBuf_Finalize(v10, 1);
                    CUser_Send(CUser, v10);
                } finally {
                    Destroy_PacketGuard_PacketGuard(v10);
                }
                return;
            }
        }
        CUser_SendUpdateItemList(CUser, 1, UPDATE_TYPE_INVENTORY, Slot);
    },
    /**
    * 超链接高亮消息
    * @param {*} user  用户
    * @param {*} strarr 消息数组【消息类型str/其他，消息，rgba】 
    * @param {*} msgtype 广播类型
    0.为上方系统公告栏   
    1.为下方对话框/绿色  
    2.为下方对话框/蓝色  
    3.为下方对话框/白色  
    5.为下方对话框/白色  
    6.为下方对话框/紫色  
    7.为下方对话框/绿色  
    8.为下方对话框/橙色  
    9.为下方对话框/蓝色  
    10.为喇叭，但是会乱码      
    11.为喇叭  
    12.为喇叭  
    13.为喇叭  
    14.为喇叭  
    * @param {*} Symbol 表情
    */
    api_CUser_SendHyperLinkChatMsg_Emoji(user, strarr, msgtype, Symbol) {
        const bufferSize = 255;
        const strptr = Memory.alloc(bufferSize);
        let startlen = 0;
        let cnt = 0;

        // 准备表情符号数据
        const emojiBytes = Symbol >= 1 ? [0xc2, 0x80, 0x20, 0x1e, 0x20, Symbol, 0x1f] : [0xc2, 0x80, 0x20];
        strptr.add(startlen).writeByteArray(emojiBytes);
        startlen += emojiBytes.length;

        // 处理消息字符串数组
        for (const item of strarr) {
            const [strtype, msgContent, flags] = item;

            strptr.add(startlen).writeByteArray([0xc2, 0x80]);
            startlen += 2; // 更新起始长度 

            const msgstr = (strtype === 'str') ? msgContent + '' : '[' + api_CItem_GetItemName(parseInt(msgContent)) + ']';
            const str_ptr = Memory.allocUtf8String(msgstr);
            const str_len = strlen(str_ptr);
            strptr.add(startlen).writeByteArray(str_ptr.readByteArray(str_len));
            startlen += str_len;

            // 检查是否需要添加额外的字节 
            if (flags[3] === 255) {
                strptr.add(startlen).writeByteArray([0xc2, 0x80]);
                startlen += 2;
                cnt++;
            }
        }
        // 结束字符串并准备数据包
        strptr.add(startlen).writeByteArray([0xc2, 0x80]);
        startlen += 2;
        const packet_guard = api_PacketGuard_PacketGuard();
        try {
            InterfacePacketBuf_Put_Header(packet_guard, 0, 370);
            InterfacePacketBuf_Put_Byte(packet_guard, msgtype);
            InterfacePacketBuf_Put_Short(packet_guard, 0);
            InterfacePacketBuf_Put_Byte(packet_guard, 0);
            InterfacePacketBuf_Put_Int(packet_guard, startlen);
            InterfacePacketBuf_Put_Str(packet_guard, strptr, startlen);
            InterfacePacketBuf_Put_Byte(packet_guard, cnt);
            // 处理附加信息
            for (const item of strarr) {
                const [_, msgtype, flags] = item;
                if (flags[3] === 255) {
                    const RbgInfoptr = Memory.alloc(104);
                    RbgInfoptr.writeByteArray(flags);
                    // 处理消息类型
                    if (typeof msgtype === 'number') {
                        RbgInfoptr.add(0x4).writeU32(msgtype);
                        const Citem = api_CDataManager_Find_Item(msgtype);
                        if (!CItem_Is_Stackable(Citem)) {
                            RbgInfoptr.add(0x8).writeU32(get_rand_int(0));
                            RbgInfoptr.add(0xe).writeU16(CEquipItem_Get_Endurance(Citem));
                        }
                    }
                    InterfacePacketBuf_Put_Binary(packet_guard, RbgInfoptr, 104);
                }
            }
            // 完成数据包
            InterfacePacketBuf_Finalize(packet_guard, 1);
            // 发送数据包
            CUser_SendPacket(user, 1, packet_guard);
        } finally {
            // 清理数据包
            Destroy_PacketGuard_PacketGuard(packet_guard);
        }

    }
}

//module.name 获取模块名
module.exports = {
    api
};
