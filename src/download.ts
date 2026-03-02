import {Dependence, Flag, Pkg} from './typedef';
import fs from 'fs';
import request from 'request';
import {join, resolve} from 'path';
import {parse} from 'yaml';

let succeed_callback: () => void;

interface PnpmResolution {
    tarball?: string;
    integrity?: string;
}

interface PnpmPackageItem {
    resolution?: PnpmResolution;
}

interface YarnLockItem {
    version?: string;
    resolved?: string;
    integrity?: string;
}

const DOWNLOAD_RETRY_TIMES = 3;
const DOWNLOAD_CONCURRENCY = Math.max(1, Number(process.env.DOWNLOAD_CONCURRENCY || 8));
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);

function getRegistryBase() {
    const raw = (process.env.NPM_REGISTRY_BASE || 'https://registry.npmmirror.com/').trim();
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

const REGISTRY_BASE = getRegistryBase();

function sanitizeFileName(fileName: string) {
    return fileName.replace(/[\\/:*?"<>|]/g, '');
}

function buildFileNameFromFullName(fullName: string) {
    const replacedSlash = fullName.replace(/\//g, '_');
    const replacedAt = replacedSlash.startsWith('@')
        ? `@${replacedSlash.slice(1).replace(/@/g, '_')}`
        : replacedSlash.replace(/@/g, '_');
    return sanitizeFileName(replacedAt);
}

function buildRegistryUrl(pathname: string) {
    const fixedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return `${REGISTRY_BASE}${fixedPath}`;
}

function buildTarballUrl(packageName: string, version: string) {
    const finalName = packageName.split('/').pop() || packageName;
    return buildRegistryUrl(`${packageName}/-/${finalName}-${version}.tgz`);
}

function replaceNpmRegistry(url: string) {
    return url.replace(/^https?:\/\/registry\.npmjs\.org/i, REGISTRY_BASE);
}

function normalizeTarballUrl(url: string) {
    if (!url) {
        return '';
    }
    if (url.startsWith('https://') || url.startsWith('http://')) {
        return replaceNpmRegistry(url);
    }
    if (url.startsWith('//')) {
        return replaceNpmRegistry(`https:${url}`);
    }
    if (url.startsWith('/')) {
        return buildRegistryUrl(url);
    }
    return url;
}

function parsePnpmPackageKey(key: string) {
    const atIndex = key.startsWith('@')
        ? key.indexOf('@', key.indexOf('/') + 1)
        : key.indexOf('@');
    if (atIndex <= 0) {
        return null;
    }

    const name = key.slice(0, atIndex);
    const rawVersion = key.slice(atIndex + 1);
    const version = rawVersion.split('(')[0];
    if (!name || !version) {
        return null;
    }

    return {name, version};
}

function parseYarnSelectorPackageName(selector: string) {
    const npmAliasIndex = selector.indexOf('@npm:');
    if (npmAliasIndex > 0) {
        return selector.slice(0, npmAliasIndex);
    }

    if (selector.startsWith('@')) {
        const slashIndex = selector.indexOf('/');
        const atIndex = selector.indexOf('@', slashIndex + 1);
        return atIndex > 0 ? selector.slice(0, atIndex) : selector;
    }

    const atIndex = selector.indexOf('@');
    return atIndex > 0 ? selector.slice(0, atIndex) : selector;
}

function parseYarnLock(path: string): Record<string, YarnLockItem> {
    const lockfilePath = join(path, 'yarn.lock');
    const text = fs.readFileSync(lockfilePath, 'utf-8');
    const lines = text.split(/\r?\n/);
    const result: Record<string, YarnLockItem> = {};

    let selectors: string[] = [];
    let item: YarnLockItem = {};

    const flush = () => {
        if (!selectors.length || !item.version) {
            selectors = [];
            item = {};
            return;
        }
        for (const selector of selectors) {
            result[selector] = {
                ...item
            };
        }
        selectors = [];
        item = {};
    };

    for (const line of lines) {
        if (!line.trim()) {
            continue;
        }

        if (!line.startsWith(' ')) {
            flush();
            if (!line.trim().endsWith(':')) {
                continue;
            }

            const rawHeader = line.trim().slice(0, -1);
            selectors = rawHeader
                .split(',')
                .map(a => a.trim().replace(/^"|"$/g, ''))
                .filter(Boolean);
            continue;
        }

        const content = line.trim();
        if (content.startsWith('version ')) {
            item.version = content.slice('version '.length).trim().replace(/^"|"$/g, '');
            continue;
        }
        if (content.startsWith('resolved ')) {
            const resolved = content.slice('resolved '.length).trim().replace(/^"|"$/g, '');
            item.resolved = normalizeTarballUrl(resolved.split('#')[0]);
            continue;
        }
        if (content.startsWith('integrity ')) {
            item.integrity = content.slice('integrity '.length).trim().replace(/^"|"$/g, '');
            continue;
        }
    }

    flush();
    return result;
}

function parsePackageNameFromPackageLockKey(key: string) {
    const marker = 'node_modules/';
    const markerIndex = key.lastIndexOf(marker);
    const packageName = markerIndex >= 0 ? key.slice(markerIndex + marker.length) : key;
    return packageName || '';
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryByCode(code?: string) {
    if (!code) {
        return false;
    }
    return RETRYABLE_ERROR_CODES.has(code);
}

async function renameWithRetry(fromPath: string, toPath: string, times = 3) {
    let lastError: any;
    for (let i = 1; i <= times; i++) {
        try {
            if (fs.existsSync(toPath)) {
                fs.unlinkSync(toPath);
            }
            fs.renameSync(fromPath, toPath);
            return;
        } catch (error: any) {
            lastError = error;
            if ((error?.code === 'EPERM' || error?.code === 'EBUSY') && i < times) {
                await sleep(120 * i);
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

function getPackagesFromPackageLock(path: string): Pkg[] {
    const lockfilePath = join(path, 'package-lock.json');
    const {packages} = JSON.parse(
        fs.readFileSync(lockfilePath, 'utf-8')) as { packages: Record<string, Dependence> };

    const keys = Object.keys(packages).filter(a => !!a);
    const result: Pkg[] = [];
    for (const key of keys) {
        const dependence = packages[key];
        if (typeof dependence?.resolved === 'undefined') {
            continue;
        }
        const packageName = parsePackageNameFromPackageLockKey(key);
        if (!packageName) {
            continue;
        }
        const fullName = `${packageName}@${dependence.version}`;
        const name = buildFileNameFromFullName(fullName);
        result.push({
            ...dependence,
            savePath: '',
            name
        });
    }

    return result;
}

function getPackagesFromPnpmLock(path: string): Pkg[] {
    const lockfilePath = join(path, 'pnpm-lock.yaml');
    const lockfile = parse(fs.readFileSync(lockfilePath, 'utf-8')) as { packages?: Record<string, PnpmPackageItem> };
    const packages = lockfile?.packages ?? {};
    const result: Pkg[] = [];
    const seen = new Set<string>();

    for (const [rawKey, pkgItem] of Object.entries(packages)) {
        const packageInfo = parsePnpmPackageKey(rawKey);
        if (!packageInfo) {
            continue;
        }

        const packageName = packageInfo.name;
        const version = packageInfo.version;
        const tarballFromLock = normalizeTarballUrl(pkgItem?.resolution?.tarball || '');
        const resolved = tarballFromLock || buildTarballUrl(packageName, version);
        const fullName = `${packageName}@${version}`;
        const name = buildFileNameFromFullName(fullName);
        const uniqueKey = fullName;

        if (seen.has(uniqueKey)) {
            continue;
        }
        seen.add(uniqueKey);

        result.push({
            resolved,
            version,
            integrity: pkgItem?.resolution?.integrity || '',
            savePath: '',
            name
        });
    }

    return result;
}

function getPackagesFromYarnLock(path: string): Pkg[] {
    const yarnItems = parseYarnLock(path);
    const result: Pkg[] = [];
    const seen = new Set<string>();

    for (const [selector, item] of Object.entries(yarnItems)) {
        const packageName = parseYarnSelectorPackageName(selector);
        const version = item.version || '';
        if (!packageName || !version) {
            continue;
        }

        const resolved = normalizeTarballUrl(item.resolved || buildTarballUrl(packageName, version));
        if (!resolved) {
            continue;
        }

        const fullName = `${packageName}@${version}`;
        if (seen.has(fullName)) {
            continue;
        }
        seen.add(fullName);

        result.push({
            resolved,
            version,
            integrity: item.integrity || '',
            savePath: '',
            name: buildFileNameFromFullName(fullName)
        });
    }

    return result;
}

function getAllPackages(path: string): Pkg[] {
    if (fs.existsSync(join(path, 'package-lock.json'))) {
        return getPackagesFromPackageLock(path);
    }
    if (fs.existsSync(join(path, 'pnpm-lock.yaml'))) {
        return getPackagesFromPnpmLock(path);
    }
    if (fs.existsSync(join(path, 'yarn.lock'))) {
        return getPackagesFromYarnLock(path);
    }
    return [];
}

function startDownloadSafe(path: string) {
    void download(path).catch((error: any) => {
        console.error(`download task failed in ${path}:`, error?.message || error);
    });
}

/**
 * 下载tgz文件
 * @param pkg 包信息
 * @param flag 标志对象
 */
async function downloadTgz(pkg: Pkg, flag: Flag) {
    const finalPath = join(pkg.savePath, pkg.name + '.tgz');
    const tempPath = join(pkg.savePath, pkg.name + '.downloading');

    let lastError: any;
    for (let attempt = 1; attempt <= DOWNLOAD_RETRY_TIMES; attempt++) {
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }

        try {
            await new Promise<void>((resolvePromise, rejectPromise) => {
                const stream = fs.createWriteStream(tempPath, {autoClose: true});
                const req = request(pkg.resolved, {timeout: 60 * 1000});
                let settled = false;

                const rejectOnce = (error: any) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    if (fs.existsSync(tempPath)) {
                        try {
                            fs.unlinkSync(tempPath);
                        } catch {
                        }
                    }
                    rejectPromise(error);
                };

                const resolveOnce = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    resolvePromise();
                };

                const rejectWithCleanup = (error: any) => {
                    req.removeAllListeners();
                    stream.removeAllListeners();
                    rejectOnce(error);
                };

                req.on('error', rejectWithCleanup);
                stream.on('error', rejectWithCleanup);

                req.pipe(stream);
                stream.on('close', async () => {
                    try {
                        if (fs.existsSync(tempPath)) {
                            await renameWithRetry(tempPath, finalPath);
                            resolveOnce();
                        } else {
                            rejectOnce(new Error('download temp file missing'));
                        }
                    } catch (error) {
                        rejectOnce(error);
                    }
                });
            });

            flag.success++;
            downloadEnd(flag, pkg.name);
            return;
        } catch (error: any) {
            lastError = error;
            const errorCode = error?.code as string | undefined;
            if (attempt < DOWNLOAD_RETRY_TIMES && shouldRetryByCode(errorCode)) {
                console.log(`retry ${pkg.name} (${attempt}/${DOWNLOAD_RETRY_TIMES}) due to ${errorCode}`);
                await sleep(800 * attempt);
                continue;
            }
        }
    }

    flag.failedList.push(`${pkg.name}: ${lastError?.code || lastError?.message || 'unknown error'}\n`);
    downloadEnd(flag, pkg.name);
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
            console.log(`下载结束，成功${flag.success}个，失败${flag.failedList.length}个：`);
            console.log(flag.failedList);
        }
    }
}

/**
 * 下载
 * @param path 路径
 */
async function download(path: string) {
    const packageList = getAllPackages(path);
    const uniquePackageMap = new Map<string, Pkg>();
    for (const pkg of packageList) {
        if (!uniquePackageMap.has(pkg.name)) {
            uniquePackageMap.set(pkg.name, pkg);
        }
    }
    const uniquePackageList = Array.from(uniquePackageMap.values());

    const tgzPath = resolve(process.cwd(), 'dl_tgzs');
    const historyTgzPath = resolve(process.cwd(), 'history_tgzs');
    if (!fs.existsSync(tgzPath)) {
        fs.mkdirSync(tgzPath, {recursive: true});
    }

    const pendingList = uniquePackageList.filter(pkg => {
        const fileName = pkg.name + '.tgz';
        return !fs.existsSync(join(tgzPath, fileName)) && !fs.existsSync(join(historyTgzPath, fileName));
    });
    const downloadableList = pendingList.filter(pkg => typeof pkg.resolved !== 'undefined' && !!pkg.resolved);
    const dedupedCount = packageList.length - uniquePackageList.length;
    const skippedCount = uniquePackageList.length - pendingList.length;
    const invalidCount = pendingList.length - downloadableList.length;
    if (dedupedCount > 0) {
        console.log(`已去重${dedupedCount}个重复依赖`);
    }
    if (skippedCount > 0) {
        console.log(`已跳过${skippedCount}个本地已下载文件`);
    }
    if (invalidCount > 0) {
        console.log(`已跳过${invalidCount}个无下载地址的依赖`);
    }

    const flag: Flag = {
        total: downloadableList.length,
        current: 0,
        success: 0,
        failedList: []
    };

    if (flag.total === 0) {
        console.log('无需下载，目标文件均已存在。');
        succeed_callback?.();
        return;
    }

    const workerCount = Math.min(DOWNLOAD_CONCURRENCY, downloadableList.length);
    console.log(`并行下载线程数: ${workerCount}`);

    let cursor = 0;
    const worker = async () => {
        while (true) {
            const current = cursor;
            cursor++;
            if (current >= downloadableList.length) {
                return;
            }

            const packageItem = downloadableList[current];
            const pkg: Pkg = {
                ...packageItem,
                savePath: tgzPath,
            };
            if (fs.existsSync(join(pkg.savePath, pkg.name + '.tgz')) || fs.existsSync(join(historyTgzPath, pkg.name + '.tgz'))) {
                flag.current++;
                flag.success++;
                console.log(`${flag.current}/${flag.total}---skip ${pkg.name}`);
                continue;
            }
            await downloadTgz(pkg, flag);
        }
    };

    const workers = Array.from({length: workerCount}, () => worker());
    await Promise.all(workers);
}

/**
 * 开始下载
 * @param path 存在 package-lock.json 的文件夹路径
 * @param callback 下载成功后回调
 */
export function start(path: string, callback?: () => any) {
    succeed_callback = callback;
    const stats = fs.statSync(path);
    if (stats.isDirectory() && (fs.existsSync(join(path, 'package-lock.json')) || fs.existsSync(join(path, 'pnpm-lock.yaml')) || fs.existsSync(join(path, 'yarn.lock')))) {
        startDownloadSafe(path);
    }
}

/**
 * 批量下载
 * @param path 存在多个 package-lock.json 的子文件夹的文件夹路径
 */
export function startBatch(path: string) {
    const stats = fs.statSync(path);
    if (stats.isDirectory()) {
        if (fs.existsSync(join(path, 'package-lock.json')) || fs.existsSync(join(path, 'pnpm-lock.yaml')) || fs.existsSync(join(path, 'yarn.lock'))) {
            startDownloadSafe(path);
        } else {
            const files = fs.readdirSync(path);
            files.forEach(file => startBatch(join(path, file)));
        }
    }
}
