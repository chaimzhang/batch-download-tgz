import {Dependence, Flag, Pkg} from './typedef';
import fs from 'fs';
import request from 'request';
import {clearDir, mkdirsSync} from './util';
import {join} from 'path';

let succeed_callback: () => void;

/**
 * 下载tgz文件
 * @param pkg 包信息
 * @param flag 标志对象
 */
async function downloadTgz(pkg: Pkg, flag: Flag) {

    const stream = fs.createWriteStream(join(pkg.savePath, pkg.name), {autoClose: true});

    await request(pkg.resolved, {timeout: 60 * 1000 * 60,}).pipe(stream).on('finish', () => {
        const name = pkg.name + '.tgz';
        if (fs.existsSync(join(pkg.savePath, pkg.name))) {
            fs.renameSync(join(pkg.savePath, pkg.name), join(pkg.savePath, name));
            flag.success++;
            downloadEnd(flag, pkg.name);
        } else {
            flag.total--;
        }
    }).on('error', () => {
        flag.failedList.push(pkg.name + '/n');
        downloadEnd(flag, pkg.name);
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
            succeed_callback?.();
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
async function download(path: string) {
    if (fs.existsSync(`${path}package-lock.json`)) {
        const {packages} = JSON.parse(
            fs.readFileSync(`${path}package-lock.json`, 'utf-8')) as { packages: Record<string, Dependence> };
        const keys = Object.keys(packages).filter(a => !!a);
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
        };
        for (const key of keys) {
            const list = key.split('/');
            const name = list[list.length - 1] + '-' + (packages[key].version).replace(/[\\\/:*?\"<>|]/g, "");
            const pkg: Pkg = {
                ...packages[key],
                savePath: tgzPath,
                name
            };
            if (typeof pkg.resolved === 'undefined' || fs.existsSync(join(pkg.savePath, pkg.name)) || fs.existsSync(join(pkg.savePath, pkg.name + '.tgz'))) {
                flag.total--;
                console.log('delete ' + pkg.name)
                break;
            }
            await downloadTgz(pkg, flag).then();
        }
    }
}

/**
 * 开始下载
 * @param path 存在 package-lock.json 的文件夹路径
 * @param callback 下载成功后回调
 */
export function start(path: string, callback?: () => any) {
    succeed_callback = callback;
    const stats = fs.statSync(path);
    if (stats.isDirectory() && fs.existsSync(path + '/package-lock.json')) {
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
