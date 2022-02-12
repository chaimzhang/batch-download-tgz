import {Dependence, Flag, Pkg} from "./typedef";
import fs from 'fs';
import path from 'path'
import request from "request";
import {clearDir, mkdirsSync} from "./util";

/**
 * 下载tgz文件
 * @param pkg 包信息
 * @param flag 标志对象
 */
function downloadTgz(pkg: Pkg, flag: Flag) {

    if (fs.existsSync(pkg.savePath + pkg.name)) {
        flag.total--;
        return;
    }
    if (!fs.existsSync(pkg.savePath)) {
        mkdirsSync(pkg.savePath);
    }

    const stream = fs.createWriteStream(path.join(pkg.savePath, pkg.name), {autoClose: true});
    request(pkg.resolved).pipe(stream).on('finish', () => {
        flag.success++;
        downloadEnd(flag, pkg.name)
    }).on('error', () => {
        flag.failedList.push(pkg.name + '/n');
        downloadEnd(flag, pkg.name)
    });
}

/**
 * 下载结束
 * @param flag
 * @param name
 */
function downloadEnd(flag: Flag, name: string) {
    flag.current++;
    console.log(`${flag.current}/${flag.total}---${name}`);
    if (flag.current === flag.total) {
        if (flag.success === flag.total) {
            console.log(flag.total + '个全部下载成功！');
        } else {
            console.log(`下载结束，成功${flag.total - flag.success}个，失败${flag.failedList.length}个：`);
            console.log(flag.failedList);
        }
    }
}

/**
 * 下载
 * @param path 路径
 */
function download(path: string) {
    if (fs.existsSync(`${path}package-lock.json`)) {
        const {dependencies} = JSON.parse(fs.readFileSync(`${path}package-lock.json`, "utf-8")) as { dependencies: Record<string, Dependence> };
        const keys = Object.keys(dependencies);
        const tgzPath = path + 'tgzs/';
        if (fs.existsSync(tgzPath)) {
            clearDir(tgzPath);
        } else {
            fs.mkdirSync(tgzPath);
        }
        const flag = {
            total: keys.length,
            current: 0,
            success: 0,
            failedList: []
        }
        for (const key of keys) {
            const list = key.split('/');
            const name = list[list.length - 1] + '-' + dependencies[key].version + '.tgz';
            const pkg: Pkg = {
                ...dependencies[key],
                savePath: tgzPath + key + '/',
                name,
            };
            downloadTgz(pkg, flag);
        }
    }
}

/**
 * 开始下载
 * @param path 存在 package-lock.json 的文件夹路径
 */
export function start(path: string) {
    const stats = fs.statSync(path);
    if (stats.isDirectory() && fs.existsSync(path + 'package-lock.json')) {
        download(path);
    }
}

/**
 * 批量下载
 * @param path 存在多个 package-lock.json 的子文件夹的文件夹路径
 */
export function startBatch(path: string) {
    const stats = fs.statSync(path);
    if (stats.isDirectory()) {
        if (fs.existsSync(path + 'package-lock.json')) {
            download(path);
        } else {
            const files = fs.readdirSync(path);
            files.forEach(file => startBatch(`${path}${file}/`));
        }
    }
}