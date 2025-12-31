/** 
 * game-utils.js
 * 游戏通用工具模块（基础模块，后面慢慢整理）
 * 20250901 by Tim
 */

/** 模块配置 */
var _config = {
}

////////////////////////////////////////////////////////////////////////
// 接口
////////////////////////////////////////////////////////////////////////

// --------------- CInventory 相关接口 ------------------

/**获取背包对应槽位的装备物品对象 (背包，背包栏类型，格子) */
var CInventory_GetInvenRef = new NativeFunction(ptr(0x84FC1DE), 'pointer', ['pointer', 'int', 'int'], { "abi": "sysv" });
/**增加金币*/
var CInventory_Gain_Money = new NativeFunction(ptr(0x84FF29C), 'int', ['pointer', 'int', 'int', 'int', 'int'], { "abi": "sysv" });
/**背包中删除道具(背包指针, 背包类型, 槽, 数量, 删除原因, 记录删除日志)*/
var CInventory_Delete_Item = new NativeFunction(ptr(0x850400C), 'int', ['pointer', 'int', 'int', 'int', 'int', 'int'], { "abi": "sysv" });
var CInventory_MakeItemPacket = new NativeFunction(ptr(0x084FC6BC), 'int', ['pointer', 'int', 'int', 'pointer'], { "abi": "sysv" });

// --------------- Inven_Item 相关接口 ------------------

/**检查背包中道具是否为空*/
var Inven_Item_IsEmpty = new NativeFunction(ptr(0x811ED66), 'int', ['pointer'], { "abi": "sysv" });
/**获取背包中道具item_id*/
var Inven_Item_GetKey = new NativeFunction(ptr(0x850D14E), 'int', ['pointer'], { "abi": "sysv" });
/**道具是否是装备*/
var Inven_Item_IsEquipableItemType = new NativeFunction(ptr(0x08150812), 'int', ['pointer'], { "abi": "sysv" });
/**删除背包槽中的道具*/
var Inven_Item_Reset = new NativeFunction(ptr(0x080CB7D8), 'int', ['pointer'], { "abi": "sysv" });

// --------------- CItem 相关接口 ------------------

var CItem_GetRarity = new NativeFunction(ptr(0x80f12d6), 'int', ['pointer'], { "abi": "sysv" });
var CItem_GetUsableLevel = new NativeFunction(ptr(0x80f12ee), 'int', ['pointer'], { "abi": "sysv" });
var CItem_GetItemName = new NativeFunction(ptr(0x811ed82), 'int', ['pointer'], { "abi": "sysv" });
/**道具是否为消耗品*/
var CItem_Is_Stackable = new NativeFunction(ptr(0x80F12FA), 'int', ['pointer'], { "abi": "sysv" });

// --------------- CEquipItem 相关接口 ------------------
/** 获取耐久度 */
var CEquipItem_Get_Endurance = new NativeFunction(ptr(0x811ED98), 'int', ['pointer'], { "abi": "sysv" });

// --------------- CStackableItem 相关接口 ------------------

// /**获取消耗品类型*/
var CStackableItem_GetItemType = new NativeFunction(ptr(0x8514A84), 'int', ['pointer'], { "abi": "sysv" });
// /**获取徽章支持的镶嵌槽类型*/
var CStackableItem_GetJewelTargetSocket = new NativeFunction(ptr(0x0822CA28), 'int', ['pointer'], { "abi": "sysv" });

// --------------- CAccountCargo 相关接口 ------------------

/**获取账号金库一个空的格子*/
var CAccountCargo_GetEmptySlot = new NativeFunction(ptr(0x0828a580), 'int', ['pointer'], { "abi": "sysv" });
/**将物品移动到某个格子 第一个账号金库，第二个移入的物品，第三个格子位置*/
var CAccountCargo_InsertItem = new NativeFunction(ptr(0x08289c82), 'int', ['pointer', 'pointer', 'int'], { "abi": "sysv" });
/**向客户端发送账号金库列表*/
var CAccountCargo_SendItemList = new NativeFunction(ptr(0x0828a88a), 'int', ['pointer'], { "abi": "sysv" });

// --------------- CGameManager 相关接口 ------------------

var G_CGameManager = new NativeFunction(ptr(0x080cc18e), 'pointer', [], { "abi": "sysv" });
/**  * 根据AccId获取User [CGameManager,AccId]*/
var CGameManager_GetUserByAccId = new NativeFunction(ptr(0x082948C6), 'pointer', ['pointer', 'int'], { 'abi': 'sysv' });

// --------------- CDungeon 相关接口 ------------------

/** 读取角色所在副本id*/
var CDungeon_GetDungeonIdxAfterClear = new NativeFunction(ptr(0x0867CB90), 'int', ['pointer'], { "abi": "sysv" });
/** 根据副本ID获取副本名称*/
var CDungeon_GetDungeonName = new NativeFunction(ptr(0x81455A6), 'pointer', ['pointer'], { "abi": "sysv" });

// --------------- CDataManager 相关接口 ------------------

/** 获取DataManager实例 用于处理pvf的*/
var G_CDataManager = new NativeFunction(ptr(0x80CC19B), 'pointer', [], { "abi": "sysv" });
/** 获取pvf数据*/
var CDataManager_Find_Dungeon = new NativeFunction(ptr(0x835F9F8), 'pointer', ['pointer', 'int'], { "abi": "sysv" });
/**从pvf中获取任务数据*/
var CDataManager_Find_Quest = new NativeFunction(ptr(0x835FDC6), 'pointer', ['pointer', 'int'], { "abi": "sysv" });
/**获取装备pvf数据*/
var CDataManager_Find_Item = new NativeFunction(ptr(0x835FA32), 'pointer', ['pointer', 'int'], { "abi": "sysv" });

// --------------- CParty 相关接口 ------------------
 
//获取队伍中玩家
const CParty_Get_User = new NativeFunction(ptr(0x08145764), 'pointer', ['pointer', 'int'], { "abi": "sysv" });


////////////////////////////////////////////////////////////////////////
// 变量
////////////////////////////////////////////////////////////////////////

/**获取背包槽中的道具（对象）
  * 
  * 身上穿的装备(0-26)[0-9时装][10-21装备][22宠物]
  * 
  * 物品栏(0-311)
  * 
  * 时装栏(0-104)
  * 
  * 宠物装备(0-241)
  * 
  * 3-8快捷栏 9-56装备栏 57-104消耗品栏 105-152材料栏153-200任务栏 201-248副职业栏 249-311徽章栏
  */
const INVENTORY_TYPE = {
    INVENTORY_TYPE_BODY: 0,         //身上穿的装备(0-26)
    INVENTORY_TYPE_ITEM: 1,            //物品栏(0-311)
    INVENTORY_TYPE_AVARTAR: 2,         //时装栏(0-104)
    INVENTORY_TYPE_CREATURE: 3       //宠物装备(0-241)
}

////////////////////////////////////////////////////////////////////////
// 函数
////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////
// 导出
////////////////////////////////////////////////////////////////////////

/** CInventory 相关 */
const cinven = {
    CInventory_GetInvenRef,
    CInventory_Gain_Money,
    CInventory_Delete_Item,
    CInventory_MakeItemPacket,

    INVENTORY_TYPE,

    Inven_Item_IsEmpty,
    Inven_Item_IsEquipableItemType,
    Inven_Item_GetKey,
    Inven_Item_Reset,

    /**
    * 根据背包类型以及所在位置返回物品信息
    * @param {*} invenContext 背包指针
    * @param {*} invenType 背包类型
    * @param {*} slot 物品所在背包位置
    * @returns 
    */
    getItemInfoByInvenAndSlot(invenContext, invenType, slot) {
        const validTypes = Object.values(INVENTORY_TYPE);
        if (!validTypes.includes(invenType))
            return null;
        let item = CInventory_GetInvenRef(invenContext, invenType, slot);
        if (!item)
            return null;
        let itemId = Inven_Item_GetKey(item);
        let baseInfo = citem.getItemPvfInfoById(itemId);
        if (!baseInfo)
            return null;

        baseInfo.context = item; // item 对象

        // 这里需要判断一下是不是装备
        if (Inven_Item_IsEquipableItemType(item)) {
            baseInfo.upgrade = item.add(6).readU8();// 强化等级
            baseInfo.increase = item.add(17).readU16();        // 增幅
            baseInfo.forge = item.add(51).readU8(); // 锻造
            baseInfo.inlay = item.add(25).readU32();// 真装备镶嵌
            baseInfo.pearl = item.add(13).readU32();// 宝珠

            // 使用职业，暂时不要了
            // baseInfo.useJob = "";
            // for (var i = 60; i <= 70; i++) {
            //     baseInfo.useJob += itemData.add(i).readU8();
            // }
        }
        return baseInfo;
    }
}

/** CItem 相关 */
const citem = {
    CItem_Is_Stackable,
    CItem_GetRarity,

    /**获取道具名字*/
    api_CItem_GetItemName(item_id) {
        if (!item_id)
            return null;
        var citem = cdataManager.api_CDataManager_Find_Item(item_id);
        if (citem && !citem.isNull()) {
            return ptr(CItem_GetItemName(citem)).readUtf8String(-1);
        }
        return item_id.toString();
    },
    /**
     * 根据物品ID返回PVF中的信息
     * @param {*} itemId 
     * @returns 
     */
    getItemPvfInfoById(itemId) {
        if (!itemId)
            return null;
        var itemData = cdataManager.api_CDataManager_Find_Item(itemId);
        var itemType = itemData.add(141 * 4).readU32(); // 装备类型
        var itemRarity = CItem_GetRarity(itemData); // 稀有度   
        var itemLevel = CItem_GetUsableLevel(itemData);  //等级

        return {
            id: itemId,
            type: itemType,
            rarity: itemRarity,
            useLevel: itemLevel
        };
    },
}

/** CEquipItem 相关 */
const cequipItem={
    CEquipItem_Get_Endurance
}

/** CStackableItem 相关 */
const cstackableItem = {
    CStackableItem_GetItemType,
    CStackableItem_GetJewelTargetSocket
}

/** CGameManager 相关 */
const cgameManager = {
    /** 
     * 根据账号ID获取User
     * @param {*} accId 账号ID
     */
    api_CGameManager_GetUserByAccId(accId) {
        if (!accId)
            return null;
        return CGameManager_GetUserByAccId(G_CGameManager(), accId);
    }
}

/** CAccountCargo 相关 */
const caccountCargo = {
    CAccountCargo_GetEmptySlot,
    CAccountCargo_InsertItem,
    CAccountCargo_SendItemList
}

/** CDataManager 相关 */
const cdataManager = {
    G_CDataManager,
    CDataManager_Find_Quest,
    CDataManager_Find_Item,

    api_CDataManager_Find_Item(itemId) {
        if (!itemId)
            return null;
        return CDataManager_Find_Item(G_CDataManager(), itemId);
    }
}

/** CDungeon 相关 */
const cdungeon = {

    CDungeon_GetDungeonIdxAfterClear,
    /** 
     * 根据副本ID获取副本名字
     * @param {*} dungeon_id 
     * @returns 
     */
    api_CDungeon_GetDungeonName(dungeon_id) {
        var cdungeon = CDataManager_Find_Dungeon(G_CDataManager(), dungeon_id);
        if (!cdungeon.isNull()) {
            return ptr(CDungeon_GetDungeonName(cdungeon)).readUtf8String(-1);
        }
        return dungeon_id.toString();
    },
}

/** CParty 相关 */
const cparty={
    CParty_Get_User
}

module.exports = {
    cinven,
    citem,
    cequipItem,
    cstackableItem,
    caccountCargo,
    cgameManager,
    cdataManager,
    cdungeon,
    cparty
};
