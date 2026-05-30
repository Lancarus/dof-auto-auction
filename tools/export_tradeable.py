"""
导出 PVF 中可进入拍卖补货画像的装备和道具，并生成可导入 SQL。

先用pvfUT把装备和道具提取出来

初版策略：
- 只使用 equipment.lst / stackable.lst 映射出的 item_id。
- SQL 导入 frida.auction_item_profile，不直接写 auction_main。
- 导入时全量清理 auction_item_profile 后重建。
- 装备价格以本文件注释中的乘算模型为准，基础价只取 value / 5。
- 材料类道具生成 100-25000 的稳定波动价格。
- 消耗类道具有 price 时以 price 为上限；无 price 时只允许白名单类型进入。

用法:
  python export_tradeable.py
  python export_tradeable.py --pvf-root G:\\dnfsifu\\develop\\pvfTiqu
"""

import argparse
import hashlib
import json
import re
from pathlib import Path


# ======== 配置 ========
DEFAULT_PVF_ROOT = Path(r"G:\dnfsifu\develop\pvfTiqu")
OUTPUT_JSON = "tradeable_items.json"
OUTPUT_SQL = "tradeable_item_profile_import.sql"
SOURCE_NAME = "pvf_tradeable"
MAX_RECOMMENDED_PRICE = 999_999_999

EQUIPMENT_DIR = "equipment"
STACKABLE_DIR = "stackable"
EQUIPMENT_LST = "equipment/equipment.lst"
STACKABLE_LST = "stackable/stackable.lst"


# ======== 装备需读取数据字段 ========
# name是游戏中所显示的第1个名字，如果含有“传承”字符即为传承装备

# name2是通常是该装备、物品的英文名


# attach type绑定类型
# `[free]` = 不限制
# `[sealing]` = 封装
# `[trade]` = 不可交易
# `[account]` = 帐号绑定
# `[trade delete]` = 无法交易、删除
# `[sealing trade]` = 封装且不可交易
TRADEABLE_ATTACH_TYPES = {"free", "sealing"}

# rarity稀有度名称
# 装备稀有度 0.普通 1.高级 2.稀有 3.神器 4及以上过滤
RARITY_NAMES = {
    0: "普通",
    1: "高级",
    2: "稀有",
    3: "神器",
    4: "史诗",
    5: "勇者",
    6: "传说",
    7: "神话",
}

# minimum level代表使用等级限制也可以看成是武器等级

# equipment type装备类型
# [title name] = 称号
# [weapon] = 武器
# [coat] = 上衣
# [pants] = 下衣
# [hat] = 帽子
# [shoulder] = 护肩
# [waist] = 腰带
# [shoes] = 鞋子
# [amulet] = 项链
# [wrist] = 手镯
# [ring] = 戒指
# [support] = 辅助装备
# [aurora avatar] = 光环
# [magic stone] = 魔法石
# [creature]=寵物
# [artifact red] = 宠物装备 红
# [artifact blue] = 宠物装备 蓝
# [artifact green] = 宠物装备 绿
# [skin avatar] = 皮肤
# [face avatar] = 脸部装扮
# [equipment type]时装 皮肤
# [pants avatar] = 下衣时装

# item group name具体的物品类型
# `ssword`   = 短剑
# `totem`    = 图腾
# `katana`   = 太刀
# `automatic`= 自动步枪
# `club`     = 钝器
# `lswd`     = 巨剑
# `beamswd`  = 光剑
# `knuckle`  = 手套
# `claw`     = 爪
# `tonfa`    = 东方棍
# `gauntlet` = 臂铠
# `hcannon`  = 手炮
# `wrist`    = 手镯
# `la coat`  = 上衣
# `lt pants` = 褲子
# `la waist` = 腰帶
# `magic stone` = 魔法石(左右槽)
# ---------------------------------
# `mt pants` = 板甲下装
# `mt waist` = 板甲腰带
# `mt coat` = 板甲上衣
# `mt shoes` = 板甲鞋子
# `mt shoulder` = 板甲护肩
# ---------------------------------
# `ha pants` = 重甲下装
# `ha waist` = 重甲腰带
# `ha coat` = 重甲上衣
# `ha shoes` = 重甲鞋子
# `ha shoulder` = 重甲护肩
# ---------------------------------
# `lt pants` = 皮甲下装
# `lt waist` = 皮甲腰带
# `lt coat` = 皮甲上衣
# `lt shoes` = 皮甲鞋子
# `lt shoulder` = 皮甲护肩
# ---------------------------------
# `la pants` = 轻甲下装
# `la waist` = 轻甲腰带
# `la coat` = 轻甲上衣
# `la shoes` = 轻甲鞋子
# `la shoulder` = 轻甲护肩
# ---------------------------------
# `cl pants` = 布甲下装
# `cl waist` = 布甲腰带
# `cl coat` = 布甲上衣
# `cl shoes` = 布甲鞋子
# `cl shoulder` = 布甲护肩
# ---------------------------------
# `amulet` = 项链


# usable job 可使用职业
# `[all]` = 所有职业
# `[creator mage]` = 缔造者
# `[swordman]` = 鬼剑士(男)
# `[at swordman]` = 鬼剑士(女)
# `[demonic swordman]` = 黑暗武士
# `[fighter]` = 格斗家(女)
# `[at fighter]` = 格斗家(男)
# `[gunner]` = 神枪手(男)
# `[at gunner]` = 神枪手(女)
# `[mage]` = 魔法师(女)
# `[at mage]` = 魔法师(男)
# `[priest]` = 圣职者(男)
# `[thief]` = 暗夜使者

# value游戏中价值,实际售出价为1/5

# set item master 套装属性，如果有即为套装

# ======== 装备因子 ========
# 装备价格因数：
# # 第一个因数映射表：基于装备种类
EQUIPMENT_GROUP_FACTOR_MAP = {
    "bglove": 0.75,
    "claw": 0.95,
    "gauntlet": 0.95,
    "knuckle": 1.0,
    "tonfa": 1.0,
    "automatic": 1.25,
    "bowgun": 1.1,
    "hcannon": 1.25,
    "musket": 1.0,
    "revolver": 1.5,
    "broom": 1.05,
    "pole": 0.9,
    "rod": 0.75,
    "spear": 1.0,
    "staff": 1.1,
    "axe": 0.7,
    "cross": 0.5,
    "rosary": 0.5,
    "scythe": 1.0,
    "totem": 0.7,
    "beamswd": 1.6,
    "club": 0.9,
    "lswd": 1.75,
    "katana": 1.25,
    "ssword": 1.5,
    "dagger": 1.0,
    "twinswd": 0.9,
    "wand": 0.75,
    "amulet": 1.75,
    "ring": 2.0,
    "wrist": 2.0,
    "mt pants": 0.75,
    "mt waist": 0.75,
    "mt coat": 0.6,
    "mt shoes": 1.0,
    "mt shoulder": 1.0,
    "ha pants": 2.1,
    "ha waist": 2.75,
    "ha coat": 1.75,
    "ha shoes": 3.35,
    "ha shoulder": 2.75,
    "lt pants": 1.75,
    "lt waist": 2.75,
    "lt coat": 1.25,
    "lt shoes": 3.0,
    "lt shoulder": 2.75,
    "la pants": 2.0,
    "la waist": 3.1,
    "la coat": 2.0,
    "la shoes": 3.1,
    "la shoulder": 3.1,
    "cl pants": 1.25,
    "cl waist": 2.75,
    "cl coat": 1.25,
    "cl shoes": 3.0,
    "cl shoulder": 2.25,
}
# # 第二个因数（基于物品等级）
# y=x^2 / 60^2 * 3 + 1
# # 第三个因数（基于物品稀有度）
# # (2紫,3粉 -> 1倍,4倍)。 1 + (x-1)*l/60
# # 第四个因数（传承）
# 传承 3倍
# # 第五个因数（套装）
# 套装1.5倍


# ======== 道具需读取数据字段 ========
# name是游戏中所显示的第1个名字，如果为空就排除

# stackable type 物品类型，除了材料其他都是消耗品
# [recipe] = 设计图
# [upgradable legacy] = 罐子类
# [quest]=任务物品（被放在背包的任务物品栏）
# [booster random] = 随机魔盒
# [multi upgradable legacy] = 幸运礼盒
# [booster] = 礼包：使用后获得(所有/随机)物品
# [booster selection] = 礼包：可选
# [cera booster] = 礼包：自动使用
# [unlimited waste]=重复使用
# [material]=材料
# [usable cera package] 0=时装礼包开启后可自己选择属性
MATERIAL_STACKABLE_TYPES = {
    "material",
    "material expert job",
    "enchant waste",
    "waste",
    "unlimited waste",
}

PRICELESS_CONSUMABLE_ALLOWLIST = {
    "expert town potion",
    "town and dungeon",
    "avatar emblem",
    "upgrade limit cube",
    "etc",
}

HIGH_VALUE_STACKABLE_TYPES = {
    "avatar emblem",
    "upgrade limit cube",
}

BLOCKED_CONSUMABLE_STACKABLE_TYPES = {
    "recipe",
    "avatar emblem",
    "upgradable legacy",
    "multi upgradable legacy",
    "multi upgradable legacy bonus cera",
}

BLOCKED_STACKABLE_PATH_PREFIXES = (
    "cash/",
    "emblem/",
    "event/",
    "fp/",
    "professional/recipe/",
    "recipe/",
    "temp/",
    "twdf/",
)

COMMON_STACKABLE_PRIORITY_IDS = {
    3033, 3034, 3035, 3036, 3037, 3038, 3039, 3040, 3041, 3042,
    6001, 6002, 6003, 6004, 6005, 6006, 6007, 6008, 6009, 6010, 6011, 6012, 6013,
}

MID_VALUE_STACKABLE_TYPES = {
    "material",
    "material expert job",
    "enchant waste",
    "booster",
    "booster selection",
    "town and dungeon",
    "expert town potion",
    "throw",
}


PROFILE_COLUMNS = [
    "item_id",
    "cname",
    "category",
    "raw_category_code",
    "market_tier",
    "base_price",
    "min_listings",
    "max_listings",
    "min_total_quantity",
    "max_total_quantity",
    "preferred_stack_min",
    "preferred_stack_max",
    "volatility",
    "bot_trade_weight",
    "system_trade_weight",
    "rotation_weight",
    "enabled",
    "source",
    "category_source",
    "classification_confidence",
    "suggested_price",
    "suggested_tier",
    "updated_at",
]


def parse_args():
    parser = argparse.ArgumentParser(description="Generate auction_item_profile SQL from PVF export.")
    parser.add_argument("--pvf-root", default=str(DEFAULT_PVF_ROOT), help="PVF export root directory.")
    parser.add_argument("--json-out", default=OUTPUT_JSON, help="JSON report output path.")
    parser.add_argument("--sql-out", default=OUTPUT_SQL, help="SQL import output path.")
    return parser.parse_args()


def clean_key_value(value):
    value = str(value).strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    return value.strip().lower()


def parse_scalar(value, default=0):
    if value is None or value == "":
        return default
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def format_price(price):
    return f"{int(price):,}"


def sql_escape(value):
    return str(value).replace("\\", "\\\\").replace("'", "''")


def stable_int(seed):
    digest = hashlib.sha1(str(seed).encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


def stable_range(seed, min_value, max_value):
    min_value = int(min_value)
    max_value = int(max_value)
    if max_value <= min_value:
        return min_value
    return min_value + stable_int(seed) % (max_value - min_value + 1)


def normalize_rel_path(path_text):
    return path_text.replace("\\", "/").strip().lower()


def parse_lst_file(lst_path):
    text = Path(lst_path).read_text(encoding="utf-8", errors="ignore")
    lines = [line.strip() for line in text.splitlines() if line.strip() and line.strip() != "#PVF_File"]
    entries = {}
    i = 0
    while i + 1 < len(lines):
        item_id_match = re.fullmatch(r"\d+", lines[i])
        path_match = re.search(r"`([^`]*)`", lines[i + 1])
        if item_id_match and path_match:
            item_id = int(lines[i])
            rel_path = normalize_rel_path(path_match.group(1))
            entries[rel_path] = item_id
            i += 2
        else:
            i += 1
    return entries


def parse_key_values(content, key):
    pattern = re.compile(r"^\[" + re.escape(key) + r"\]\s*$", re.IGNORECASE | re.MULTILINE)
    match = pattern.search(content)
    if not match:
        return []

    start = match.end()
    next_section = re.search(r"^\[[^\]/][^\]]*\]\s*$", content[start:], re.MULTILINE)
    end = start + next_section.start() if next_section else len(content)
    body = content[start:end]

    values = []
    for quoted in re.findall(r"`([^`]*)`", body):
        values.append(quoted)

    if values:
        return values

    for number in re.findall(r"(?m)^\s*(-?\d+)\s*$", body):
        values.append(int(number))
    return values


def first_value(content, key, default=None):
    values = parse_key_values(content, key)
    return values[0] if values else default


def has_section(content, key):
    return bool(re.search(r"^\[" + re.escape(key) + r"\]\s*$", content, re.IGNORECASE | re.MULTILINE))


def is_bad_name(name):
    text = str(name)
    return not name or not text.strip() or "旧" in text or "舊" in text


def determine_equip_type(equipment_type_key):
    if not equipment_type_key:
        return "unknown"
    eq_type = clean_key_value(equipment_type_key)
    if eq_type in ("amulet", "ring", "wrist"):
        return "jewelry"
    if eq_type in ("magic stone", "support"):
        return "lr_slots"
    if eq_type in ("pants", "waist", "coat", "shoes", "shoulder"):
        return "armor"
    if "avatar" in eq_type or eq_type in ("title name", "creature"):
        return "avatar_or_special"
    return "weapon"


def calc_equipment_price(name, level, rarity, item_group, value, has_set_bonus):
    base = value / 5.0
    if base <= 0:
        return 0

    level = max(1, level)
    group_factor = EQUIPMENT_GROUP_FACTOR_MAP.get(clean_key_value(item_group), 1.0)
    level_factor = (level * level) / (60.0 * 60.0) * 3.0 + 1.0
    rarity_factor = 1.0 + (rarity - 1) * level / 60.0
    rarity_factor = max(0.1, rarity_factor)
    inherit_factor = 3.0 if "传承" in str(name) else 1.0
    set_factor = 1.5 if has_set_bonus else 1.0

    price = base * group_factor * level_factor * rarity_factor * inherit_factor * set_factor
    return max(1, min(MAX_RECOMMENDED_PRICE, int(round(price))))


def equipment_policy(rarity, level):
    if rarity >= 4:
        return None
    if rarity == 3 and level >= 40:
        return {
            "market_tier": "A",
            "min_listings": 1,
            "max_listings": 2,
            "min_total_quantity": 1,
            "max_total_quantity": 2,
            "volatility": "0.35",
            "bot_trade_weight": "0.20",
            "rotation_weight": "0.30",
        }
    if rarity == 2 and level >= 40:
        return {
            "market_tier": "B",
            "min_listings": 3,
            "max_listings": 5,
            "min_total_quantity": 3,
            "max_total_quantity": 5,
            "volatility": "0.30",
            "bot_trade_weight": "0.16",
            "rotation_weight": "0.18",
        }
    return {
        "market_tier": "C",
        "min_listings": 0,
        "max_listings": 1,
        "min_total_quantity": 0,
        "max_total_quantity": 1,
        "volatility": "0.35",
        "bot_trade_weight": "0.08",
        "rotation_weight": "0.03",
    }


def stackable_category(stack_type):
    return "material" if stack_type in MATERIAL_STACKABLE_TYPES else "consumable"


def stackable_tier(stack_type, rarity):
    if stack_type in HIGH_VALUE_STACKABLE_TYPES or rarity >= 3:
        return "A"
    if stack_type in MID_VALUE_STACKABLE_TYPES or rarity == 2:
        return "B"
    return "C"


def stackable_price(item_id, stack_type, rarity, price):
    if stack_type in MATERIAL_STACKABLE_TYPES:
        return stable_range(f"material:{item_id}", 100, 25_000)

    if price > 0:
        upper = max(100, price)
        return stable_range(f"consumable:{item_id}", 100, upper)

    if stack_type not in PRICELESS_CONSUMABLE_ALLOWLIST:
        return 0

    if stack_type in HIGH_VALUE_STACKABLE_TYPES:
        return stable_range(f"priceless-high:{item_id}", 5_000, 100_000)
    if stack_type in ("expert town potion", "town and dungeon"):
        return stable_range(f"profession:{item_id}", 500, 15_000)
    return stable_range(f"priceless:{item_id}", 500, 25_000)


def stackable_policy(stack_type, rarity, stack_limit):
    tier = stackable_tier(stack_type, rarity)
    stack_limit = max(1, stack_limit or 1)
    preferred_stack_max = min(stack_limit, 500)
    preferred_stack_min = min(preferred_stack_max, 300)
    max_listings = 10

    if tier == "A":
        volatility = "0.30"
        bot_weight = "0.22"
        rotation = "0.35"
    elif tier == "B":
        volatility = "0.22"
        bot_weight = "0.18"
        rotation = "0.20"
    else:
        volatility = "0.20"
        bot_weight = "0.08"
        rotation = "0.03"

    return {
        "market_tier": tier,
        "min_listings": 0,
        "max_listings": max_listings,
        "min_total_quantity": preferred_stack_min * max_listings,
        "max_total_quantity": preferred_stack_max * max_listings,
        "preferred_stack_min": preferred_stack_min,
        "preferred_stack_max": preferred_stack_max,
        "volatility": volatility,
        "bot_trade_weight": bot_weight,
        "rotation_weight": rotation,
    }


def promote_common_stackable(item_id, policy):
    if item_id not in COMMON_STACKABLE_PRIORITY_IDS:
        return policy

    promoted = dict(policy)
    promoted["market_tier"] = "A"
    promoted["bot_trade_weight"] = "0.30"
    promoted["rotation_weight"] = "0.75"
    return promoted


def make_profile(item, category, raw_category_code, policy):
    return {
        "item_id": item["item_id"],
        "cname": item["name"],
        "category": category,
        "raw_category_code": raw_category_code,
        "market_tier": policy["market_tier"],
        "base_price": item["base_price"],
        "min_listings": policy["min_listings"],
        "max_listings": policy["max_listings"],
        "min_total_quantity": policy["min_total_quantity"],
        "max_total_quantity": policy["max_total_quantity"],
        "preferred_stack_min": policy.get("preferred_stack_min", 1),
        "preferred_stack_max": policy.get("preferred_stack_max", 1),
        "volatility": policy["volatility"],
        "bot_trade_weight": policy["bot_trade_weight"],
        "system_trade_weight": "0.00",
        "rotation_weight": policy["rotation_weight"],
        "enabled": 1,
        "source": SOURCE_NAME,
        "category_source": "pvf",
        "classification_confidence": "0.85",
        "suggested_price": item["base_price"],
        "suggested_tier": policy["market_tier"],
        "updated_at": "NOW()",
    }


def read_text(path):
    return Path(path).read_text(encoding="utf-8", errors="ignore")


def build_path_to_item_id(pvf_root, rel_dir, lst_rel_path):
    lst_path = pvf_root / lst_rel_path
    by_rel = parse_lst_file(lst_path)
    result = {}
    base = pvf_root / rel_dir
    for rel_path, item_id in by_rel.items():
        full = (base / rel_path).resolve()
        result[normalize_rel_path(str(full))] = item_id
    return result


def parse_equipment_file(path, item_id, pvf_root):
    content = read_text(path)
    attach_type = clean_key_value(first_value(content, "attach type", ""))
    if attach_type not in TRADEABLE_ATTACH_TYPES:
        return None, "not_tradeable"

    name = first_value(content, "name", "")
    if is_bad_name(name):
        return None, "bad_name"

    rarity = parse_scalar(first_value(content, "rarity", 0), 0)
    if rarity >= 4:
        return None, "equipment_rarity_4_plus"

    level = parse_scalar(first_value(content, "minimum level", first_value(content, "grade", 1)), 1)
    value = parse_scalar(first_value(content, "value", 0), 0)
    if value <= 0:
        return None, "equipment_no_value"

    item_group = first_value(content, "item group name", "")
    equip_type_key = first_value(content, "equipment type", "")
    equip_type = determine_equip_type(equip_type_key)
    has_set = has_section(content, "set item master")

    base_price = calc_equipment_price(name, level, rarity, item_group, value, has_set)
    if base_price <= 0:
        return None, "equipment_no_price"

    policy = equipment_policy(rarity, level)
    if policy is None:
        return None, "equipment_policy_skip"

    rel_file = str(Path(path).resolve().relative_to(pvf_root.resolve())).replace("\\", "/")
    item = {
        "type": "equipment",
        "item_id": item_id,
        "name": name,
        "file": rel_file,
        "attach_type": attach_type,
        "rarity": rarity,
        "rarity_name": RARITY_NAMES.get(rarity, "未知"),
        "level": level,
        "equip_type": equip_type,
        "equipment_type": clean_key_value(equip_type_key),
        "item_group": clean_key_value(item_group),
        "value": value,
        "base_price": base_price,
        "base_price_fmt": format_price(base_price),
        "has_set_bonus": has_set,
        "market_tier": policy["market_tier"],
    }
    return item, None


def parse_stackable_file(path, item_id, pvf_root):
    content = read_text(path)
    rel_file = str(Path(path).resolve().relative_to(pvf_root.resolve())).replace("\\", "/")
    rel_stackable_file = rel_file[len(f"{STACKABLE_DIR}/"):] if rel_file.startswith(f"{STACKABLE_DIR}/") else rel_file
    rel_stackable_file = normalize_rel_path(rel_stackable_file)
    if rel_stackable_file.startswith(BLOCKED_STACKABLE_PATH_PREFIXES):
        return None, "stackable_blocked_path"
    if item_id >= 100000:
        return None, "stackable_high_item_id"

    attach_type = clean_key_value(first_value(content, "attach type", ""))
    if attach_type not in TRADEABLE_ATTACH_TYPES:
        return None, "not_tradeable"

    name = first_value(content, "name", "")
    if is_bad_name(name):
        return None, "bad_name"

    rarity = parse_scalar(first_value(content, "rarity", 0), 0)
    stack_type = clean_key_value(first_value(content, "stackable type", "unknown")) or "unknown"
    category = stackable_category(stack_type)
    if category == "consumable" and stack_type in BLOCKED_CONSUMABLE_STACKABLE_TYPES:
        return None, "consumable_blocked_stackable_type"

    price = parse_scalar(first_value(content, "price", 0), 0)
    stack_limit_raw = first_value(content, "stack limit", None)
    stack_limit = parse_scalar(stack_limit_raw, 1000 if stack_limit_raw is None else 1)
    if stack_limit <= 1:
        return None, "stackable_not_stackable"

    min_level = parse_scalar(first_value(content, "minimum level", 1), 1)

    base_price = stackable_price(item_id, stack_type, rarity, price)
    if base_price <= 0:
        return None, "stackable_no_price_not_allowlisted"

    policy = promote_common_stackable(item_id, stackable_policy(stack_type, rarity, stack_limit))

    item = {
        "type": "stackable",
        "item_id": item_id,
        "name": name,
        "file": rel_file,
        "attach_type": attach_type,
        "rarity": rarity,
        "rarity_name": RARITY_NAMES.get(rarity, "未知"),
        "min_level": min_level,
        "stackable_type": stack_type,
        "stackable_category": category,
        "stack_limit": stack_limit,
        "original_price": price,
        "base_price": base_price,
        "base_price_fmt": format_price(base_price),
        "market_tier": policy["market_tier"],
    }
    return item, None


def scan_files(pvf_root, rel_dir, extension, item_id_by_path, parser):
    items = []
    profiles = []
    skipped = {}
    total = 0
    mapped = 0
    base = pvf_root / rel_dir
    files = list(base.rglob(f"*{extension}"))

    for index, path in enumerate(files, 1):
        if index % 5000 == 0:
            print(f"    进度: {index}/{len(files)}")
        total += 1
        item_id = item_id_by_path.get(normalize_rel_path(str(path.resolve())))
        if item_id is None:
            skipped["missing_lst_mapping"] = skipped.get("missing_lst_mapping", 0) + 1
            continue
        mapped += 1

        try:
            item, reason = parser(path, item_id, pvf_root)
        except Exception as exc:
            reason = f"parse_error:{type(exc).__name__}"
            item = None

        if item is None:
            skipped[reason or "filtered"] = skipped.get(reason or "filtered", 0) + 1
            continue

        if item["type"] == "equipment":
            policy = equipment_policy(item["rarity"], item["level"])
            profile = make_profile(item, "equipment", 11000 + item["rarity"], policy)
        else:
            policy = promote_common_stackable(
                item["item_id"],
                stackable_policy(item["stackable_type"], item["rarity"], item["stack_limit"])
            )
            category = item["stackable_category"]
            raw_category_code = 13000 if category == "material" else 12000
            profile = make_profile(item, category, raw_category_code, policy)

        items.append(item)
        profiles.append(profile)

    return items, profiles, {"total_files": total, "mapped_files": mapped, "skipped": skipped}


def sql_value(value):
    if value == "NOW()":
        return value
    if isinstance(value, int):
        return str(value)
    return "'" + sql_escape(value) + "'"


def build_insert_sql(profile):
    values = [sql_value(profile[column]) for column in PROFILE_COLUMNS]
    return (
        "INSERT INTO auction_item_profile ("
        + ", ".join(PROFILE_COLUMNS)
        + ") VALUES ("
        + ", ".join(values)
        + ");"
    )


def write_sql(path, profiles):
    lines = [
        "USE frida;",
        "START TRANSACTION;",
        "DELETE FROM auction_item_profile;",
    ]
    lines.extend(build_insert_sql(profile) for profile in profiles)
    lines.extend(
        [
            "COMMIT;",
            f"-- Generated profiles: {len(profiles)}",
            f"-- Source: {SOURCE_NAME}",
        ]
    )
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def count_by(items, key):
    result = {}
    for item in items:
        value = item.get(key, "unknown")
        result[value] = result.get(value, 0) + 1
    return dict(sorted(result.items(), key=lambda kv: str(kv[0])))


def main():
    args = parse_args()
    pvf_root = Path(args.pvf_root)
    if not pvf_root.exists():
        raise SystemExit(f"PVF root not found: {pvf_root}")

    print("=" * 72)
    print("  PVF 可交易物品补货画像 SQL 生成工具")
    print("=" * 72)
    print(f"  PVF目录: {pvf_root}")

    print("\n[1/4] 读取 LST item_id 映射")
    equipment_ids = build_path_to_item_id(pvf_root, EQUIPMENT_DIR, EQUIPMENT_LST)
    stackable_ids = build_path_to_item_id(pvf_root, STACKABLE_DIR, STACKABLE_LST)
    print(f"  equipment.lst: {len(equipment_ids)} 条")
    print(f"  stackable.lst: {len(stackable_ids)} 条")

    print(f"\n[2/4] 解析装备文件 ({EQUIPMENT_DIR}/)")
    equipment, equipment_profiles, equipment_stats = scan_files(
        pvf_root, EQUIPMENT_DIR, ".equ", equipment_ids, parse_equipment_file
    )
    print(f"  [OK] 导入画像装备: {len(equipment_profiles)}")

    print(f"\n[3/4] 解析道具文件 ({STACKABLE_DIR}/)")
    stackable, stackable_profiles, stackable_stats = scan_files(
        pvf_root, STACKABLE_DIR, ".stk", stackable_ids, parse_stackable_file
    )
    print(f"  [OK] 导入画像道具: {len(stackable_profiles)}")

    profiles = equipment_profiles + stackable_profiles
    profiles.sort(key=lambda p: ({"A": 0, "B": 1, "C": 2}.get(p["market_tier"], 9), p["item_id"]))
    all_items = equipment + stackable

    print("\n[4/4] 写入 JSON 和 SQL")
    report = {
        "meta": {
            "description": "PVF可交易物品补货画像及导入SQL来源数据",
            "pvf_root": str(pvf_root),
            "total_profiles": len(profiles),
            "total_equipment_profiles": len(equipment_profiles),
            "total_stackable_profiles": len(stackable_profiles),
            "equipment_stats": equipment_stats,
            "stackable_stats": stackable_stats,
            "market_tier": count_by(all_items, "market_tier"),
            "equipment_by_type": count_by(equipment, "equip_type"),
            "stackable_by_type": count_by(stackable, "stackable_type"),
            "stackable_by_category": count_by(stackable, "stackable_category"),
            "rarity": count_by(all_items, "rarity"),
        },
        "equipment": equipment,
        "stackable": stackable,
    }

    Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_sql(args.sql_out, profiles)

    print(f"  JSON: {args.json_out}")
    print(f"  SQL:  {args.sql_out}")

    print(f"\n{'=' * 72}")
    print("  生成完成")
    print(f"{'=' * 72}")
    print(f"  装备画像: {len(equipment_profiles):>6}")
    print(f"  道具画像: {len(stackable_profiles):>6}")
    print(f"  合计画像: {len(profiles):>6}")
    print("\n  市场档位:")
    for tier, count in count_by(all_items, "market_tier").items():
        print(f"    {tier}: {count}")
    print("\n  装备跳过:")
    for reason, count in sorted(equipment_stats["skipped"].items(), key=lambda kv: -kv[1]):
        print(f"    {reason}: {count}")
    print("\n  道具跳过:")
    for reason, count in sorted(stackable_stats["skipped"].items(), key=lambda kv: -kv[1]):
        print(f"    {reason}: {count}")


if __name__ == "__main__":
    main()
