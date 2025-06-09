////////////////////////////////////////////////////////////////////////
//接口
////////////////////////////////////////////////////////////////////////

/**linux文件操作 */
var fopen = new NativeFunction(Module.getExportByName(null, 'fopen'), 'int', ['pointer', 'pointer'], { "abi": "sysv" });
var fread = new NativeFunction(Module.getExportByName(null, 'fread'), 'int', ['pointer', 'int', 'int', 'int'], { "abi": "sysv" });
var fclose = new NativeFunction(Module.getExportByName(null, 'fclose'), 'int', ['int'], { "abi": "sysv" });

////////////////////////////////////////////////////////////////////////
//变量
////////////////////////////////////////////////////////////////////////

const common = {};

const global_config = {};
const moduleCache = {}; 

////////////////////////////////////////////////////////////////////////
//函数
////////////////////////////////////////////////////////////////////////

/**
 * 读取文件
 * @param {*} path 路径
 * @param {*} mode 模式
 * @param {*} len 长度 
 * @returns 
 */
common.readFile = (path, mode, len) => {
	var path_ptr = Memory.allocUtf8String(path);
	var mode_ptr = Memory.allocUtf8String(mode);
	var f = fopen(path_ptr, mode_ptr);

	if (f == 0)
		return null;

	var data = Memory.alloc(len);
	var fread_ret = fread(data, 1, len, f);

	fclose(f);

	//返回字符串
	if (mode == 'r')
		return data.readUtf8String(fread_ret);

	//返回二进制buff指针
	return data;
}

/**
 * 读取配置文件
 * @param {*} path 路径
 * @returns 配置对象
 */
common.loadConfig = (path) => {
	var data = common.readFile(path, 'r', 10 * 1024 * 1024);
	return JSON.parse(data);
}

/**
* 自定义模块加载函数，实现类似Node.js的require功能
* 支持模块缓存、文件读取和模块封装执行
* @param {string} path - 模块文件的路径
* @returns {object} - 模块导出的内容
*/
function require(path) {
	// 检查模块是否已缓存，避免重复加载
	if (moduleCache[path]) return moduleCache[path];

	// 读取模块文件内容，以文本模式读取，最大支持10MB
	const src = common.readFile(path, 'r', 10 * 1024 * 1024);
	const module = { exports: {} };
	// 把模块源码包装成 function，支持 module.exports
	new Function("module", "common", "require", src)(module, common, require);
	moduleCache[path] = module.exports;
	return module.exports;
}

function loadModule(path) {

}


////////////////////////////////////////////////////////////////////////
// 三、加载公共模块和子脚本，并演示主脚本调用
////////////////////////////////////////////////////////////////////////
function start() {

	global_config = common.loadConfig('/plugins/frida/frida_config.json'); //加载本地配置文件

	const child1 = require("/dp2/frida/moduleA.js");
	const child2 = require("/dp2/frida/moduleB.js");
	child2.init();
	// 主脚本调用子脚本的变量和函数
	console.log("[main] child.childVar =", child1.childVar);
	child1.childFunc();

	////////////////////////////////////////////////////////////////////////
	// 四、统一收集所有 hooks（主脚本 + 所有子脚本）并安装
	////////////////////////////////////////////////////////////////////////

	// 1) 主脚本自己的 hook 声明
	const mainHooks = [
		{
			address: "0x8656CAA",
			moduleName: "main",
			onEnter(args) {
				console.log("[main] onEnter @0x2000feed");
			},
			onLeave(retval) {
				console.log("[main] onLeave @0x2000feed — retval =", retval);
			}
		}
	];

	// 2) 子脚本中的 hooks
	const childHooks = [
		...((child1.hooks || []).map(hook => ({ ...hook, moduleName: "moduleA" }))),
		...((child2.hooks || []).map(hook => ({ ...hook, moduleName: "moduleB" })))
	];

	// 3) 合并
	const allHooks = mainHooks.concat(childHooks);

	// 4) 统一 attach
	const hooksMap = new Map();
	// 遍历所有 hooks
	allHooks.forEach(hook => {
		if (!hooksMap.has(hook.address)) {
			hooksMap.set(hook.address, { onEnter: [], onLeave: [] });
		}

		// 将钩子的 onEnter 和 onLeave 函数添加到 hooksMap 中
		const hookEntry = hooksMap.get(hook.address);
		if (hook.onEnter) hookEntry.onEnter.push({ hook: hook.onEnter, moduleName: hook.moduleName });
		if (hook.onLeave) hookEntry.onLeave.push({ hook: hook.onLeave, moduleName: hook.moduleName });
	});

	// 遍历 hooksMap 并安装钩子
	hooksMap.forEach((hookEntry, address) => {
		Interceptor.attach(ptr(address), {
			onEnter(args) {
				// 执行所有的 onEnter 函数
				hookEntry.onEnter.forEach(fn => {
					try {
						fn.hook?.call(this, args);
					} catch (error) {
						common.commonFunc("[hook]", address, fn.moduleName, "onEnter error:", error.stack);
					}
				});
			},
			onLeave(retval) {
				// 执行所有的 onLeave 函数
				hookEntry.onLeave.forEach(fn => {
					try {
						fn.hook?.call(this, retval);
					} catch (error) {
						common.commonFunc("[hook]", address, fn.moduleName, "onLeave error:", error.stack);
					}
				});
			}
		});
	});

}

// 导出RPC接口
rpc.exports = {
	// 初始化函数 
	init: function (stage, parameters) {
		console.log('[init] stage=' + stage + ', parameters=' + JSON.stringify(parameters) + '  ====================================');
		try {

			start();
		} catch (error) {
			console.log(error);
			common.commonFunc(error.stack);
		}
		// 注册事件
	},

	// 资源释放函数
	dispose: function () {
		console.log('[dispose]');
	}

};
