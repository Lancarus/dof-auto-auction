# 仅供测试、学习使用！

# DOF Modular-Frida

> 一个为DOF服务端设计的模块化Frida-Gadget框架，核心：**mini-require** 模块化系统

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Frida](https://img.shields.io/badge/Frida-Gadget-green.svg)](https://frida.re/) 

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
├── 📄 frida.js              # 主程序入口文件
├── ⚙️ frida_config.json     # 全局配置文件
├── 🔧 frida.config          # Frida配置文件
├── 📦 frida.so              # Frida动态库文件
├── 📂 base/                 # 基础模块目录
│   ├── 📝 base-module-sample.js  # 基础模块模板
│   ├── 🗄️ mysql-database.js      # 数据库模块
│   ├── 🔧 system-manager.js      # 系统管理模块
│   └── 🛠️ utils.js               # 工具模块
└── 📂 module/               # 功能模块目录
    ├── 📝 module-sample.js       # 功能模块模板
    └── ...                       # 其他功能模块
```

## 🚀 核心特性

### ⭐ 技术亮点

- **🔧 mini-require核心** - 轻量级模块化加载系统，专为Frida-Gadget设计
- **🎯 创新实现** - 在Frida-Gadget环境中实现类似Node.js的模块管理
- **⚡ 高性能** - 优化的模块缓存和依赖注入机制
- **🛡️ 稳定性** - 完善的错误处理和模块隔离机制

### 🔧 mini-require模块加载系统

**mini-require** 是本项目的核心模块，实现了类似**Node.js**的 `require` 功能，支持：

- **📦 模块缓存** - 避免重复加载相同模块
- **🔒 模块封装** - 每个模块都有独立的执行上下文
- **💉 依赖注入** - 通过 `context` 对象提供全局API

### 🎛️ 模块管理系统

- **🏗️ 基础模块** - 提供核心功能API，如工具函数、数据库操作等（可根据需要选择使用）
- **⚡ 功能模块** - 实现具体的游戏功能扩展
- **🔄 热重载** - 通过GM命令支持运行时重新加载模块，无需重启服务器
- **🛡️ 权限控制** - 基于角色ID的权限验证系统

> **💡 模块设计说明：**
> - 基础模块和功能模块的划分是根据我的习惯设计的，也可以全部放在功能模块中
> - 基础模块通过 `context` 命名空间引用，当基础模块变化时，引用它的功能模块无需重新加载
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
    "path": "/plugins/frida/frida.js",
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
    "base": {
        "modules": [
            {
                "name": "utils",
                "path": "/plugins/frida/base/utils.js",
                "enabled": true,
                "freeze": true
            }
        ]
    },
    "common": {
        "gmCid": [1]
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
| `name` | 模块名，重载指定模块 |
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
// const { api_function } = context.utils;

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

### 🛠️ context.utils

工具模块提供的API（示例）：

```javascript
// 时间相关
context.utils.time.getTimestamp();
context.utils.time.getDate();

// 游戏系统
context.utils.gameSystem.api_DisPatcher_DebugCommand__DebugCommandSetLevel(user, level);

// 游戏世界
context.utils.gameWorld.api_GameWorld_SendNotiPacketMessage(msg, msg_type);

// 用户管理
context.utils.gameCUser.api_CUser_AddItem(user, item_id, item_cnt);
context.utils.gameCUser.api_CUser_Gain_Exp_Sp(user, exp);
```

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



### 🔗 API引用最佳实践

```javascript
// 推荐：通过context命名空间引用（热重载时无需重新加载）
function myFunction() {
    context.utils.gameCUser.api_CUser_AddItem(user, item_id, count);
    context.utils.time.getTimestamp();
}

// 不推荐：解构赋值（基础模块变化时需要重新加载此模块）
const { api_CUser_AddItem } = context.utils.gameCUser;
const { getTimestamp } = context.utils.time;
```

> **💡 重要说明：**
> - 带 `cfg` 的命令（如 `//reload cfg`、`//reload 模块名 cfg`）包含了 `reinit` 功能，会先更新配置文件并重新加载基础模块
> - 配置文件中的 `name` 字段很重要，GM重载某个模块就是根据这个 `name` 来识别的
> - 运行时新增模块需要同时更新配置文件，然后使用带 `cfg` 的命令

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
| 🧊 **freeze属性** | 所有模块都支持`freeze`属性，只有将`freeze`从`true`改为`false`时需要单独重载 |
| 📝 **模块名称** | 配置文件中的`name`字段很重要，GM重载模块就是根据这个`name`来识别的 |

---

<div align="center">

**DOF Modular-Frida** - 基于mini-require核心的DOF服务端功能扩展框架

*本文档基于项目当前版本编写，如有更新请参考最新代码实现。*

</div>

