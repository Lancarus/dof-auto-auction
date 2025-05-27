/**获取当前角色id*/
var CUserCharacInfo_getCurCharacNo = new NativeFunction(ptr(0x80CBC4E), 'int', ['pointer'], { "abi": "sysv" });

// 在加载时，就可以使用全局的 mainVar、mainFunc，以及 require() 加载 common.js
const common = require("/dp2/frida/common.js");

module.exports = {
    init() {
        common.commonFunc("Child1 init");
    },

    // 子模块自己的变量
    childVar: "I am childVar1",

    // 子模块自己的函数，会访问 main.js 挂到全局的 mainVar/mainFunc 和 common.js
    childFunc() {
        console.log("[child1] childFunc: mainVar =", mainVar);
        if (testStr)
            console.log("[child1] childFunc: mainVar Str =", testStr);
        else
            console.log("[child1] childFunc: mainVar Str = null");
        mainFunc("Hello from child1");
        common.commonFunc("Hello from child1");
    },

    // 子模块声明的 hook 点
    hooks: [
        {
            address: "0x86C4E50",
            onEnter(args) {
                common.commonFunc("[child1] onEnter @0x86C4E50 — user =", args[1]);
                this.user = args[1];
            },
            onLeave(retval) {
                common.commonFunc("[child1] onLeave @0x86C4E50 — retval =", retval);
                var charac_no = CUserCharacInfo_getCurCharacNo(this.user);
                common.commonFunc("[child1] onLeave @0x86C4E50 — user id =", charac_no);
            }
        }
    ]
};
