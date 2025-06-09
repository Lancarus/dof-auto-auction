// common.js
// 一个简单的公共模块，导出变量和函数
let f_log = null;
let log_day = null;

module.exports = {
    commonVar: "I am commonVar", 
    commonFunc(...args) {
        const msg = args.join(' '); // 将所有参数用空格连接起来
        var date = new Date();
        date = new Date(date.setHours(date.getHours() + 0));     //转换到本地时间
        var year = date.getFullYear().toString();
        var month = (date.getMonth() + 1).toString();
        var day = date.getDate().toString();
        var hour = date.getHours().toString();
        var minute = date.getMinutes().toString();
        var second = date.getSeconds().toString();
        var ms = date.getMilliseconds().toString();
 
        //日志按日期记录
        if ((f_log == null)) {
            f_log = new File('/dp2/frida/frida_' + year + '_' + month + '_' + day + '.log', 'a+');
        }

        //时间戳
        var timestamp = year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second + '.' + ms;

        //控制台日志
        console.log('[' + timestamp + ']' + msg + '\n');

        //文件日志
        f_log.write('[' + timestamp + ']' + msg + '\n');
        //立即写日志到文件中
        f_log.flush(); 
    }
};
