# Batch-Download-Tgz
根据`package-lock.json`下载所有依赖包的`tgz`文件。

## 以下载`axios`依赖为例
### 1.生成`package-lock.json`文件
- 在本项目根目录新建文件夹，如`axios-tgz`。
- 在`axios-tgz`目录执行命令`npm init`,一路回车到结束。
- 在`axios-tgz`目录执行命令`npm i axios --package-lock-only`,生成`package-lock.json`文件。
### 2.下载tgz
- 将`src/main.ts` 文件中的第三行改为 `const path = './axios-tgz/'`。
- 执行`npm run start`命令。
- 成功后可以看到下载的所有依赖保存在`axios-tgz/tgzs`中。