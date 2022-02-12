import fs from 'fs';
import path from 'path'

/**
 * 删除文件夹下所有文件及将文件夹下所有文件清空
 */
function emptyDir(path: fs.PathLike) {
    const files = fs.readdirSync(path);
    files.forEach(file => {
        const filePath = `${path}/${file}`;
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            emptyDir(filePath);
        } else {
            fs.unlinkSync(filePath);
        }
    });
}

/**
 * 删除指定路径下的所有空文件夹
 */
function rmEmptyDir(path: fs.PathLike, level = 0) {
    const files = fs.readdirSync(path);
    if (files.length > 0) {
        let tempFile = 0;
        files.forEach(file => {
            tempFile++;
            rmEmptyDir(`${path}/${file}`, 1);
        });
        if (tempFile === files.length && level !== 0) {
            fs.rmdirSync(path);
        }
    } else {
        level !== 0 && fs.rmdirSync(path);
    }
}

/**
 * 清空指定路径下的所有文件及文件夹
 */
export function clearDir(path: fs.PathLike) {
    emptyDir(path);
    rmEmptyDir(path);
}


/**
 * 同步创建目录
 * @param dirname 目录名称
 */
export function mkdirsSync(dirname: string) {
    if (fs.existsSync(dirname)) {
        return true;
    } else if (mkdirsSync(path.dirname(dirname))) {
        fs.mkdirSync(dirname);
        return true;
    }
    return false;
}