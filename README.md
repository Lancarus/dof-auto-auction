# 仅供测试、学习使用！

# DOF Modular-Frida

> 一个为DOF服务端设计的模块化Frida-Gadget框架，核心：**mini-require** 模块化系统

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Frida](https://img.shields.io/badge/Frida-Gadget-green.svg)](https://frida.re/)

## 🎉 写在前面

这个框架的核心 **mini-require** 其实早就写好了，本来想等把手头的功能模块都迁移完再发出来，结果... 一直没心思弄 😂

索性趁着元旦把这个"娱乐版"先发出来吧！功能模块就当是画饼了，以后有心情了再慢慢迁移~

**祝大家 2025 元旦快乐！🎊** 

## 📑 目录

- [✨ 特性](#-特性)
- [📁 项目结构](#-项目结构)
- [🚀 核心特性](#-核心特性)
- [📦 安装部署](#-安装部署)
- [⚙️ 配置文件](#️-配置文件)
- [📝 模块开发指南](#-模块开发指南)
- [🔧 全局API](#-全局api)
- [🎯 Hook配置](#-hook配置)
- [🔄 热重载机制](#-热重载机制)
- [💡 使用示例](#-使用示例)
- [📊 日志展示](#-日志展示)
- [⚠️ 注意事项](#️-注意事项)

## ✨ 特性

- 🚀 **mini-require核心** - 轻量级模块化加载系统，类似Node.js require
- 🔄 **热重载** - 通过GM命令实现运行时模块重载，无需重启服务器
- 🛡️ **权限管理** - 基于角色ID的权限验证系统
- 🎯 **Hook管理** - 支持多模块Hook、冲突处理和模块隔离
- 📝 **日志系统** - 完整的日志记录和文件管理
- ⚙️ **配置管理** - 灵活的配置文件系统

## 📁 项目结构

```
frida/
├── 📄 frida.js                  # 主程序入口文件
├── ⚙️ frida_config.json         # 全局配置文件
├── 🔧 frida.config              # Frida配置文件
├── 📦 frida.so                  # Frida动态库文件
├── 📂 lib/                      # 基础模块目录
│   ├── 📂 core/                 # 🔒 核心模块（系统级）
│   │   ├── 🗄️ core-mysql-database.js   # 数据库连接模块
│   │   └── 🔧 core-system-manager.js   # 系统管理模块
│   ├── 📝 base-module-sample.js # 基础模块开发模板
│   ├── 👤 base-cuser.js         # CUser基础操作封装
│   ├── 📋 base-cuser-charac-info.js  # 角色信息操作封装
│   ├── 🌍 base-game-world.js    # GameWorld操作封装
│   ├── 🎁 citem.js              # 物品操作封装
│   ├── 👤 extend-cuser.js       # CUser扩展功能
│   ├── 🌍 extend-game-world.js  # GameWorld扩展功能
│   ├── 🏪 base-auction.js       # 拍卖行基础模块
│   └── 🛠️ game-utils.js         # 游戏通用工具函数
└── 📂 module/                   # 功能模块目录
    ├── 📝 module-sample.js      # 功能模块开发模板
    ├── 🎮 gm-command.js         # GM指令模块
    ├── 🔥 abyss-mode.js         # 深渊模式模块
    ├── 🤖 auction-bot.js        # 拍卖行机器人模块
    └── ...                      # 其他功能模块
```

### 📂 目录说明

| 目录 | 说明 |
|------|------|
| `lib/core/` | **核心模块** - 系统级底层模块，如数据库连接、系统管理等，是框架运行的基础 |
| `lib/` | **基础模块** - 游戏通用API封装，提供CUser、GameWorld等常用操作的便捷接口 |
| `module/` | **功能模块** - 具体的业务功能实现，如GM指令、深渊模式等游戏功能扩展 |

## 🚀 核心特性

### ⭐ 技术亮点

- **🔧 mini-require核心** - 轻量级模块化加载系统，专为Frida-Gadget设计
- **🎯 创新实现** - 在Frida-Gadget环境中实现类似Node.js的模块管理
- **⚡ 高性能** - 优化的模块缓存和依赖注入机制
- **🛡️ 稳定性** - 完善的错误处理和模块隔离机制

### 🔧 mini-require模块加载系统

**mini-require** 是本项目的核心，在Frida-Gadget环境中实现了类似**Node.js**的模块化加载机制。

#### 核心特性

- **📦 模块缓存** - 已加载的模块会被缓存，避免重复加载和执行
- **🔒 模块封装** - 每个模块都有独立的执行上下文，互不干扰
- **💉 依赖注入** - 通过 `context` 对象向模块注入全局API

#### 实现原理

```javascript
// mini-require 核心实现
function _require(path, context, name) {
    // 1. 检查缓存，避免重复加载
    if (_moduleCache[path]) return _moduleCache[path];

    // 2. 读取模块源码
    const src = readFile(path, 'r', 10 * 1024 * 1024);

    // 3. 创建模块对象
    const module = { name: name, exports: {} };

    // 4. 使用 new Function 包装并执行模块代码
    new Function("module", "context", src)(module, context);

    // 5. 缓存并返回导出内容
    _moduleCache[path] = module.exports;
    return module.exports;
}
```

#### 与Node.js的区别

| 特性 | Node.js | mini-require |
|------|---------|--------------|
| 模块间引用 | `require('./other')` | ❌ 不支持，通过 `context` 共享 |
| 循环依赖 | 部分支持 | 从设计上避免 |
| 文件系统 | Node.js fs | Linux原生文件操作 |
| 导出方式 | `module.exports` | `module.exports` ✓ |

> **🔑 设计理念：** 模块不直接互相引用，而是通过 `context` 命名空间共享API。这种设计避免了循环依赖问题，同时支持热重载时自动更新引用。

### 🎛️ 模块管理系统

- **🏗️ 基础模块** - 提供核心功能API，如工具函数、数据库操作等（可根据需要选择使用）
- **⚡ 功能模块** - 实现具体的游戏功能扩展
- **🔄 热重载** - 通过GM命令支持运行时重新加载模块，无需重启服务器
- **🛡️ 权限控制** - 基于角色ID的权限验证系统


> **💡 模块设计说明：**
> - 基础模块和功能模块的划分是根据我的习惯设计的，也可以全部放在功能模块中
> - 基础模块之间不推荐相互引用，避免循环依赖和加载顺序问题
> - 基础模块通过 `context.模块名` 命名空间引用，当基础模块变化时，引用它的功能模块无需重新加载
> - 如果使用解构赋值 `{}` 获取基础模块对象，当基础模块变化时必须重新加载引用这些对象的功能模块

### 🎯 Hook管理系统

- **🔗 多模块Hook** - 支持多个模块同时Hook同一个地址
- **🎭 Hook类型** - 支持`attach`模式（onEnter/onLeave）和`replace`模式
- **⚖️ 冲突处理** - 自动处理Hook冲突，确保系统稳定性
- **🔒 模块隔离** - 每个模块的Hook独立管理，卸载时自动清理

## 📦 安装部署

### 🚀 快速安装

#### 1. 下载项目文件

将项目文件上传到服务器，这里以 `/plugins/frida/` 路径为例。

#### 2. 修改服务器启动脚本

找到服务器的启动脚本文件（通常是 `/root/run`），修改频道启动行：

**修改前：**
```bash
./df_game_r siroco15 start &
```

**修改后：**
```bash
LD_PRELOAD="/plugins/frida/frida.so" ./df_game_r siroco15 start &
```

#### 3. 配置Frida-Gadget

确保 `frida.config` 文件配置正确：

```json
{
  "interaction": {
    "type": "script",
    "path": "frida.js",
     "on_change": "reload"
  }
}
```

### 🔧 高级配置

#### 多频道支持

如果需要支持多个频道，可以这样配置：

```bash
# 频道1
LD_PRELOAD="/plugins/frida/frida.so" ./df_game_r siroco15 start &

# 频道2  
LD_PRELOAD="/plugins/frida/frida.so" ./df_game_r siroco16 start & 
```

### ⚠️ 安装注意事项

| 项目 | 说明 |
|------|------|
| **路径要求** | 确保所有路径使用绝对路径，避免相对路径问题 |
| **权限设置** | frida.so 和 frida.js 必须有执行权限 |
| **依赖检查** | 确保服务器环境支持 LD_PRELOAD |
| **日志目录** | 确保日志目录存在且有写入权限 |
| **配置文件** | 首次安装后需要根据实际情况调整 frida_config.json |

## ⚙️ 配置文件

### 📄 frida_config.json

```json
{
    "common": {
        "gmCid": [1]
    },
    "base": {
        "modules": [
            {
                "name": "核心模块名",
                "path": "/plugins/frida/lib/core/核心模块文件.js",
                "enabled": true,
                "freeze": true
            },
            {
                "name": "基础模块名",
                "path": "/plugins/frida/lib/基础模块文件.js",
                "enabled": true
            }
        ]
    },
    "modules": [
        {
            "name": "功能模块名",
            "path": "/plugins/frida/module/模块文件.js",
            "enabled": true
        }
    ]
}
```

#### 📋 配置项说明

| 配置项 | 说明 |
|--------|------|
| `base.modules` | 基础模块配置 |
| `common` | 全局配置，所有模块都能通过`context.config`访问 |
| `modules` | 功能模块配置 |
| `name` | 模块名，非常重要！重载指定模块、基础模块的引用 |
| `path` | 模块路径 |
| `enabled` | 是否启用模块 |
| `freeze` | 是否跳过重载（所有模块都支持，运行时修改需要单独重载） |

#### 🔧 重要变量

| 变量 | 路径 | 说明 |
|------|------|------|
| `_configPath` | `/plugins/frida/frida_config.json` | 全局配置文件路径 |
| `_logDir` | `/plugins/frida/log/` | 日志保存目录 |

> **📍 修改位置：** 这两个变量在 `frida.js` 的变量声明部分定义，如需修改路径请在此处调整。

## 📝 模块开发指南

### 🏗️ 基础模块模板

```javascript
/**
 * base-module-sample.js
 * 基础模块模板
 */

/** 模块配置 */
var _config = {
    auth: context.config.gmCid // GM权限ID，用于权限验证（全局配置文件'frida_config.json'中设置）
}

////////////////////////////////////////////////////////////////////////
// 接口
////////////////////////////////////////////////////////////////////////

const { log } = context.main;
const { INFO, WARN, ERROR } = context.main.LOG_LEVELS;

////////////////////////////////////////////////////////////////////////
// 变量 
////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////
// 函数
////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////
// 导出
////////////////////////////////////////////////////////////////////////

// 可通过 module.name 获取模块名
module.exports = {
    init() {
        // 模块初始化时调用，可选
    },
    dispose() {
        // 模块卸载时调用，可选
    },
    api: {
        // 基础模块的API接口，会被添加到全局context中
        // 当api属性是唯一导出内容时，可以省略api包装
    },
    // Frida hooks配置，可选
    // 支持attach模式(onEnter/onLeave)和replace模式
    hooks: [
        {
            address: "0x12345678",// 示例地址，请替换为实际游戏内存地址
            onEnter(args) {

            },
            onLeave(retval) {

            }
        },
        {
            address: "0x87654321",// 示例地址，请替换为实际游戏内存地址
            replace(arg1) {
                return 1;
            },
            retType: 'int',// 示例返回值，请替换为实际游戏函数返回值
            argTypes: ["pointer"],// 示例参数，请替换为实际游戏函数参数
        }
    ]
};
```

### ⚡ 功能模块模板

```javascript
/**
 * module-sample.js
 * 功能模块模板
 */

/** 模块配置 */
var _config = {
    auth: context.config.gmCid // GM权限ID，用于权限验证（全局配置文件'frida_config.json'中设置）
}

////////////////////////////////////////////////////////////////////////
// 接口
////////////////////////////////////////////////////////////////////////

const { log } = context.main;
const { INFO, WARN, ERROR } = context.main.LOG_LEVELS;

// 推荐：通过context命名空间引用基础模块API（热重载时无需重新加载）
// 示例: context.utils.api_function()

// 不推荐：使用解构赋值（基础模块变化时需要重新加载此模块）
// const { api_function } = context.utils;

////////////////////////////////////////////////////////////////////////
// 变量 
////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////
// 函数
////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////
// 导出
////////////////////////////////////////////////////////////////////////

// 可通过 module.name 获取模块名
module.exports = {
    init() {
        // 模块初始化时调用，可选
    },
    dispose() {
        // 模块卸载时调用，可选
    },
    // Frida hooks配置，可选
    // 支持attach模式(onEnter/onLeave)和replace模式
    hooks: [
        {
            address: "0x12345678",// 示例地址，请替换为实际游戏内存地址
            onEnter(args) {

            },
            onLeave(retval) {

            }
        },
        {
            address: "0x87654321",// 示例地址，请替换为实际游戏内存地址
            replace(arg1) {
                return 1;
            },
            retType: 'int',// 示例返回值，请替换为实际游戏函数返回值
            argTypes: ["pointer"],// 示例参数，请替换为实际游戏函数参数
        }
    ]
};
```

### 🏗️ 代码结构

| 部分 | 说明 |
|------|------|
| `模块配置` | 定义模块的权限、命令等配置项 |
| `接口` | 引入需要的API和常量 |
| `变量` | 模块内部使用的变量 |
| `函数` | 模块内部函数 |
| `导出` | 模块对外提供的接口 |


## 🔧 全局API

### 🏠 context.main

提供基础功能API：

```javascript
// 日志功能
context.main.log(LOG_LEVELS.INFO, "消息内容");

// 文件操作
context.main.api_mkdir("/path/to/directory");
context.main.readFile("/path/to/file", "r", 1024);

// 模块管理
context.main.module.reload("模块名"); // 重载指定模块
context.main.module.reload(); // 重载所有模块
context.main.module.reinit(); // 重新初始化
```

### ⚙️ context.config

提供全局配置访问：

```javascript
// 访问全局配置文件中的common部分
var gmCid = context.config.gmCid; // 获取GM权限角色ID列表
// 可以访问frida_config.json中common部分的所有配置项
```

### 🛠️ context.基础模块名

基础模块通过 `context.模块名` 访问，模块名由配置文件中的 `name` 字段决定：

```javascript
// 通过模块名访问基础模块API
context.utils.cinven.api_xxx();           // game-utils.js 导出的背包相关API
context.utils.citem.api_xxx();            // game-utils.js 导出的物品相关API

// 带点号的模块名需要用括号访问
context['utils.cuser'].api_CUser_AddItem(user, item_id, item_cnt);
context['utils.cuser'].api_CUser_Gain_Exp_Sp(user, exp);
context['utils.gameWorld'].api_GameWorld_SendNotiPacketMessage(msg, msg_type);
```

> **💡 提示：** 模块名支持使用点号（如 `utils.cuser`）来组织命名空间，访问时需要使用 `context['模块名']` 语法。

## 🎯 Hook配置

### 🔗 Attach模式

```javascript
hooks: [
    {
        address: "0x12345678",
        onEnter(args) {
            // 函数进入时的处理
        },
        onLeave(retval) {
            // 函数返回时的处理
        }
    }
]
```

### 🔄 Replace模式

```javascript
hooks: [
    {
        address: "0x87654321",
        replace(arg1, arg2) {
            // 替换原函数实现
            return new_value;
        },
        retType: 'int',           // 返回值类型
        argTypes: ["pointer", "int"] // 参数类型数组
    }
]
```

## 🔄 热重载机制

框架支持通过GM命令进行热重载，无需重启服务器：

### 🎮 系统管理命令

| 命令 | 说明 |
|------|------|
| `//reinit` | 重新初始化系统（重新读取配置文件，重新加载基础模块） |
| `//reload` | 重载所有功能模块 |
| `//reload 模块名` | 重载指定模块 |
| `//reload cfg` | 更新配置并重载所有模块（包含reinit功能） |
| `//reload 模块名 cfg` | 更新配置并重载指定模块（包含reinit功能） |

#### 🧊 freeze属性说明

| 值 | 行为 | 说明 |
|---|------|------|
| `freeze: true` | 跳过重载 | 模块不会被 `//reload` 命令影响 |
| `freeze: false` | 正常重载 | 模块正常参与重载 |

> **⚠️ 注意：** 只有将 `freeze` 从 `true` 改为 `false` 时需要执行 `//reload 模块名 cfg` 单独重载该模块

### ✨ 热重载优势

- 🚀 **无需重启** - 修改代码后通过GM命令即可生效
- 🎯 **精确控制** - 可以单独重载某个模块
- ⚙️ **配置更新** - 支持运行时更新配置文件
- 👨‍💻 **开发友好** - 提高开发和调试效率

## 💡 使用示例

### 📝 创建新模块

1. 在 `module/` 目录下创建新的JS文件
2. 按照功能模块模板编写代码
3. 在 `frida_config.json` 中添加模块配置
4. 使用 `//reload cfg` 命令重载模块

### 🤖 拍卖行机器人 (auction-bot)

模拟真实玩家拍卖行行为的自动化模块，通过假人角色实现物品上架、竞价、扫货、补货和价格波动。

#### 🎮 GM命令

| 命令 | 说明 |
|------|------|
| `//au status` | 查看所有引擎状态 |
| `//au snip on\|off\|now` | 狙击引擎：收购低于系统价的玩家物品 |
| `//au list on\|off\|now` | 上架引擎：假人角色随机上架物品 |
| `//au bid on\|off\|now` | 竞价引擎：假人对即将到期物品出价 |
| `//au restock on\|off\|now` | 补货引擎：系统自动补货维持供应量 |
| `//au config <key> [value]` | 读取/设置配置参数 |
| `//au chars` | 查看假人角色列表及每日统计 |
| `//au char add <name> [role]` | 添加假人角色到拍卖池 |
| `//au char remove <name>` | 从拍卖池移除假人角色 |
| `//au char role <name> seller\|bidder\|both` | 设置假人角色类型 |
| `//au stats <itemId>` | 查看物品市场统计 |
| `//au reload` | 从数据库重新加载配置 |
| `//au help` | 显示命令帮助 |

#### ⚙️ 可配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `sniping_enabled` | 0 | 狙击引擎开关 |
| `listing_enabled` | 0 | 上架引擎开关 |
| `bidding_enabled` | 0 | 竞价引擎开关 |
| `restocking_enabled` | 0 | 补货引擎开关 |
| `sniping_interval_s` | 30 | 狙击扫描间隔(秒) |
| `sniping_price_ratio` | 0.70 | 收购价格比例 |
| `listing_profit_margin` | 1.30 | 上架利润系数 |
| `max_restocks_per_cycle` | 500 | 每轮补货总上限 |
| `restock_equipment_per_cycle` | 300 | 每轮装备补货上限 |
| `restock_material_per_cycle` | 100 | 每轮材料补货上限 |
| `restock_consumable_per_cycle` | 100 | 每轮消耗品补货上限 |
| `enable_behavior_sim` | 1 | 行为模拟开关(价格随机化/高峰时段) |
| `price_randomization` | 0.15 | 价格随机化范围(±15%) |

#### 📊 数据库表

普通拍卖行使用 `taiwan_cain_auction_gold.auction_main`。`taiwan_cain_auction_cera` 是金币寄售/点券拍卖服务使用的库，对应 `df_point_r`，不要把普通拍卖补货写到 cera 库。

模块在 `frida` 库自动创建以下表：

| 表名 | 说明 |
|------|------|
| `auction_whitelist` | 白名单物品(item_id, system_price, quantity...) |
| `auction_system_config` | 系统卖家身份配置 |
| `auction_bot_characters` | 假人角色池(charac_no, role, 利润率, 每日限额) |
| `auction_bot_config` | 运行时配置参数 |
| `auction_bot_log` | 操作审计日志 |
| `auction_price_history` | 价格历史快照(价格波动算法) |
| `pending_mail` | 待发邮件队列(金币返还) |

#### ⚠️ 补货和拍卖服务约束

`//au restock now` 会直接写入普通拍卖行的 `auction_main`。写入后如果需要立即让游戏内拍卖行索引看到变化，需要重启普通拍卖服务：

```bash
/root/run2
```

`/root/run2` 只重启 `df_auction_r`，使用 `/home/neople/auction/cfg/auction_siroco.cfg`，并检查 `30803` 端口是否监听。它不重启 `df_point_r`；`df_point_r` 是金币寄售/点券拍卖服务，监听 `30603`。

直接写 `auction_main` 时必须满足拍卖服务注册约束，否则 `/root/run2` 会失败并在 `/home/neople/auction/log/run2_start.log` 中出现：

```text
Fail to RegistItem() from DB. process exits.
```

已知约束：

- `expire_time` 是 Unix 时间戳，查询时使用 `UNIX_TIMESTAMP()` 比较，不要用 `NOW()`。
- 不要写 `owner_type=1, owner_id=0` 的系统卖家行。
- `owner_type=0` 可用，但同一个 `owner_id` 不能挂太多同物品记录。实测 `item_id=3037` 同一 owner 2 条、5 条可启动，10 条会触发 `RegistItem()` 失败；10 个不同 owner 各 1 条可启动。
- 补货引擎使用 `GMTool` 风格的不同 owner 写入补货行，避免同一卖家超过拍卖服务限制。
- 避免在 `owner_name` 写入非 ASCII 名称。错误编码的中文名会在拍卖服务启动时出现 `iconv error`，并可能导致注册失败。
- 堆叠物数量要保持合法。`item_id=3037` 使用 `add_info=100` 已验证可注册。

> **💡 使用流程：** 先配置白名单和系统卖家，再通过 `//au char add` 添加假人，最后开启引擎。补货变更后用 `/root/run2` 验证普通拍卖服务能正常注册。

### 🔗 API引用最佳实践

```javascript
// 推荐：通过context命名空间引用（热重载时无需重新加载）
function myFunction() {
    context['utils.cuser'].api_CUser_AddItem(user, item_id, count);
    context.utils.cinven.api_xxx();
}

// 不推荐：解构赋值（基础模块变化时需要重新加载此模块）
const { api_CUser_AddItem } = context['utils.cuser'];
const { cinven } = context.utils;
```

> **💡 重要说明：**
> - 带 `cfg` 的命令（如 `//reload cfg`、`//reload 模块名 cfg`）包含了 `reinit` 功能，会先更新配置文件并重新加载基础模块
> - 配置文件中的 `name` 字段很重要，GM重载某个模块就是根据这个 `name` 来识别的
> - 运行时新增模块需要同时更新配置文件，然后使用带 `cfg` 的命令

## 🏪 拍卖行补货画像导出

`export_tradeable.py` 用于从 PVF 导出的 `equipment/` 和 `stackable/` 目录生成拍卖行补货画像 SQL。它不会直接写入 `taiwan_cain_auction_gold.auction_main`，而是生成可导入 `frida.auction_item_profile` 的 SQL，让 `auction-bot` 的补货引擎按画像自动上架。

### 运行方式

脚本只依赖 Python 标准库。建议使用仓库本地虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe export_tradeable.py --pvf-root G:\dnfsifu\develop\pvfTiqu
```

默认 PVF 路径就是 `G:\dnfsifu\develop\pvfTiqu`，所以在当前开发机上也可以直接运行：

```powershell
.\.venv\Scripts\python.exe export_tradeable.py
```

生成文件：

| 文件 | 说明 |
|------|------|
| `tradeable_item_profile_import.sql` | 导入 `frida.auction_item_profile` 的 SQL；初版会先清空画像表再全量重建 |
| `tradeable_items.json` | 本次扫描结果、跳过原因和分类统计，用于检查规则是否符合预期 |

导入 SQL 后，可通过 `//au restock on` 或 `//au restock now` 让补货引擎按画像生成在售拍卖。

补货画像应导入 `tradeable_item_profile_import.sql`。`tools/import-iteminfo.ps1` 生成的是旧 iteminfo 候选 SQL，仅用于排查或临时补全，不应作为 PVF 补货画像导入。

补货引擎每轮从 `auction_item_profile` 分桶读取全部启用的 A/B 档画像，按 `equipment`、`material`、`consumable` 三类分别检查当前 bot 在售数量，并持续插入拍卖行记录。默认每轮总上限为 500 条，分桶上限为装备 300、材料 100、消耗品 100；如果数据库里已经存在旧配置，需要通过 `//au config max_restocks_per_cycle 500`、`//au config restock_equipment_per_cycle 300`、`//au config restock_material_per_cycle 100`、`//au config restock_consumable_per_cycle 100` 调整。

### 过滤与定价规则

| 类别 | 规则 |
|------|------|
| `item_id` 来源 | 只使用 `equipment.lst` / `stackable.lst` 能映射出的物品 |
| 交易状态 | 只导入 `attach type` 为 `[free]` 或 `[sealing]` 的物品 |
| 名称过滤 | 名称为空、含 `旧` 或 `舊` 的物品不进入画像 |
| 装备稀有度 | 装备 `rarity >= 4` 过滤；`rarity == 2` 且等级 >= 40 进入 B 档，库存 5-10；`rarity == 3` 且等级 >= 40 进入 A 档，库存 2-4 |
| 装备价格 | 基础价只取 `value / 5`，再乘装备种类、等级、稀有度、传承、套装因子 |
| 材料类道具 | `material`、`material expert job`、`enchant waste`、`waste`、`unlimited waste` 生成 100-25000 的稳定波动价格 |
| 消耗类道具 | 有 `price` 时以 `price` 为上限生成稳定价格；无 `price` 时仅白名单类型进入 |
| 道具档位 | 道具 `rarity >= 3` 进入 A 档；`rarity == 2` 至少进入 B 档；`rarity <= 1` 按 `stackable type` 判断 |
| 堆叠数量 | 单条补货数量按 `min(stack limit, 100)` 写入 `preferred_stack_max` |

默认补货查询只取 A/B 档候选；C 档保留画像但通常不进入默认补货池。

## 📊 日志展示

### 🔍 系统启动日志

```
[2025-9-11 10:1:28.152] [INFO] ---------------- [Frida Init] Start ----------------
[2025-9-11 10:1:28.167] [INFO] **************** Main Init Start ****************
[2025-9-11 10:1:28.174] [INFO] [Main] 'config' read successfully.
[2025-9-11 10:1:28.179] [INFO] [Module] 'utils' loaded successfully.
[2025-9-11 10:1:28.180] [INFO] [Module] 'system'  initialization completed.
[2025-9-11 10:1:28.180] [INFO] [Registry] New Interceptor attach at '0x820BBDE' by module 'system'.
[2025-9-11 10:1:28.180] [INFO] [Registry] New Interceptor attach at '0x8632A18' by module 'system'.
[2025-9-11 10:1:28.180] [INFO] [Module] 'system' loaded successfully.
[2025-9-11 10:1:28.184] [INFO] [Module] 'mysql'  initialization completed.
[2025-9-11 10:1:28.184] [INFO] [Module] 'mysql' loaded successfully.
[2025-9-11 10:1:28.184] [INFO] **************** Main Init Completed ****************
[2025-9-11 10:1:28.184] [INFO] ================ Loading ALL modules ================
[2025-9-11 10:1:28.190] [INFO] [Module] 'GM指令'  initialization completed.
[2025-9-11 10:1:28.190] [INFO] [Module] 'GM指令' loaded successfully.
[2025-9-11 10:1:28.192] [INFO] [Module] '登入登出'  initialization completed.
[2025-9-11 10:1:28.198] [INFO] [Registry] New Interceptor attach at '0x86C4E50' by module '登入登出'.
[2025-9-11 10:1:28.198] [INFO] [Module] '登入登出' loaded successfully.
[2025-9-11 10:1:28.200] [INFO] [Module] 'abyss-mode'  initialization completed.
[2025-9-11 10:1:28.200] [INFO] [Registry] New Interceptor attach at '0x085a0954' by module 'abyss-mode'.
[2025-9-11 10:1:28.200] [INFO] [Module] 'abyss-mode' loaded successfully.
[2025-9-11 10:1:28.202] [INFO] [Module] 'linas'  initialization completed.
[2025-9-11 10:1:28.202] [INFO] [Registry] New Interceptor replace at '0x081db4c4' by module 'linas'.
[2025-9-11 10:1:28.202] [INFO] [Module] 'linas' loaded successfully.
[2025-9-11 10:1:28.202] [INFO] ================ ALL modules loaded ================

```
  
### ⚠️ 错误处理日志

```
[2025-9-10 17:27:53.921] [ERROR] [Module] loading module 'system':
 TypeError: '_dispatcher_list_mutex_guard_obj' is read-only
    at init (<input>:172)
    at _loadModule (/frida.js:368)
    at <anonymous> (/frida.js:445)
    at forEach (native)
    at loadAll (/frida.js:446)
    at _initMain (/frida.js:516)
    at _start (/frida.js:529)
    at onLeave (/frida.js:573)
```

### 🔄 热重载日志

```
[2025-9-11 13:11:47.812] [INFO] ================ Reloading ALL modules ================
[2025-9-11 13:11:47.812] [INFO] [Module] 'GM指令' dispose completed.
[2025-9-11 13:11:47.812] [INFO] [Module] 'GM指令' unloaded successfully.
[2025-9-11 13:11:47.812] [INFO] [Module] '登入登出' dispose completed.
[2025-9-11 13:11:47.812] [INFO] [Registry] Interceptor detached from '0x86C4E50' as no modules are listening.
[2025-9-11 13:11:47.812] [INFO] [Module] '登入登出' unloaded successfully.
[2025-9-11 13:11:47.812] [INFO] [Module] 'abyss-mode' dispose completed.
[2025-9-11 13:11:47.812] [INFO] [Registry] Interceptor detached from '0x085a0954' as no modules are listening.
[2025-9-11 13:11:47.813] [INFO] [Module] 'abyss-mode' unloaded successfully.
[2025-9-11 13:11:47.813] [INFO] [Module] 'linas' dispose completed.
[2025-9-11 13:11:47.813] [INFO] [Registry] Original function at '0x081db4c4' was restored (was replaced by 'linas').
[2025-9-11 13:11:47.813] [INFO] [Module] 'linas' unloaded successfully.
[2025-9-11 13:11:47.815] [INFO] [Module] 'GM指令'  initialization completed.
[2025-9-11 13:11:47.815] [INFO] [Module] 'GM指令' loaded successfully.
[2025-9-11 13:11:47.816] [INFO] [Module] '登入登出'  initialization completed.
[2025-9-11 13:11:47.817] [INFO] [Registry] New Interceptor attach at '0x86C4E50' by module '登入登出'.
[2025-9-11 13:11:47.817] [INFO] [Module] '登入登出' loaded successfully.
[2025-9-11 13:11:47.818] [INFO] [Module] 'abyss-mode'  initialization completed.
[2025-9-11 13:11:47.818] [INFO] [Registry] New Interceptor attach at '0x085a0954' by module 'abyss-mode'.
[2025-9-11 13:11:47.818] [INFO] [Module] 'abyss-mode' loaded successfully.
[2025-9-11 13:11:47.819] [INFO] [Module] 'linas'  initialization completed.
[2025-9-11 13:11:47.819] [INFO] [Registry] New Interceptor replace at '0x081db4c4' by module 'linas'.
[2025-9-11 13:11:47.819] [INFO] [Module] 'linas' loaded successfully.
[2025-9-11 13:11:47.819] [INFO] ================ ALL modules reloaded ================
```
 

### 🎨 日志级别说明

| 级别 | 图标 | 说明 | 使用场景 |
|------|------|------|----------| 
| `INFO` | ℹ️ | 一般信息 | 系统状态、模块加载 |
| `WARN` | ⚠️ | 警告信息 | 非致命错误、性能提醒 |
| `ERROR` | ❌ | 错误信息 | 模块加载失败、Hook异常 | 
  
> **💡 日志管理提示：**
> - 日志文件按日期、频道自动分割，便于管理和查找   

## ⚠️ 注意事项

| 项目 | 说明 |
|------|------|
| 🎯 **内存地址** | Hook地址需要根据实际游戏版本进行调整 |
| 🛡️ **权限验证** | 所有GM指令都需要验证角色ID是否在权限列表中 |
| 💾 **资源管理** | 使用资源后需要及时释放 |
| 🐛 **错误处理** | Hook函数中的异常会被捕获并记录到日志 |
| 🏗️ **模块设计** | 基础模块和功能模块的划分可根据开发习惯调整，也可以全部放在功能模块中 |
| 🔗 **API引用** | 建议使用`context`命名空间引用基础模块API，避免解构赋值导致的热重载问题 |
| ⚠️ **基础模块引用** | **基础模块之间不推荐相互引用**，特殊情况必须引用时需调整配置文件中的加载顺序 |
| 🧊 **freeze属性** | 所有模块都支持`freeze`属性，只有将`freeze`从`true`改为`false`时需要单独重载 |
| 📝 **模块名称** | 配置文件中的`name`字段很重要，GM重载模块就是根据这个`name`来识别的 |

---

<div align="center">

**DOF Modular-Frida** - 基于mini-require核心的DOF服务端功能扩展框架

*本文档基于项目当前版本编写，如有更新请参考最新代码实现。*

</div>
