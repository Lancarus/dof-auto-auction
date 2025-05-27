function test() {
    console.log("test++++++++++++++++++++++++++++++++++++++++");
}

module.exports = {
    init() {
        common.commonFunc("Child2 init");
    },

    hooks: [
        {
            address: "0x8656CAA",  // 与 child1 同地址
            onEnter(args) {
                common.commonFunc("Child2 0x8656CAA onEnter");
            }
        },
        {
            address: "0x86C5288",
            onEnter(args) {
                test();
                common.commonFunc("Child2 0x86C5288 onEnter");
            }
        }
    ]
};
