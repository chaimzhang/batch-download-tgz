/**
 * @Description: 标志
 * @author chaimzhang
 * @since 2022/2/12 18:53
 */
export interface Flag {
    /** 总数 */
    total: number;
    /** 当前位置 */
    current: number;
    /** 成功数量 */
    success: number;
    /** 失败列表 */
    failedList: string[];
}

/**
 * @Description: 依赖
 * @author chaimzhang
 * @since 2022/2/12 18:54
 */
export interface Dependence {
    /** url地址 */
    resolved: string;
    /** 版本号 */
    version: string;
}

/**
 * @Description: 包信息
 * @author chaimzhang
 * @since 2022/2/12 18:54
 */
export interface Pkg extends Dependence {
    /** 下载文件的包名 */
    name: string;
    /** 保存的路径 */
    savePath: string;
}
