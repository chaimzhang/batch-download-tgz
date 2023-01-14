# Batch-Download-Tgz

- 在内网开发时需要从外网导入依赖，一个依赖背后又有多层依赖，手动下载费时费力无法完成。 因此开发此脚本项目用于自动下载依赖及相关依赖。
- 本质是利用npm安装时生成的`package-lock.json`文件中依赖项的地址循环下载。

## 两种使用方式

### 1.根据`package-lock.json`下载所有依赖包的`tgz`文件。

若只有`package.json`文件，可先执行`npm i --package-lock-only`,生成`package-lock.json`文件。

- 将`src/main.ts` 文件中的第三行path改为目标`package-lock.json`文件所在路径。
- 执行`npm run start`命令。
- 控制台提示成功后可看到目录下tgzs文件夹内已下载的依赖文件。

### 2.根据依赖名称下载所有依赖包的`tgz`文件。
- 执行`npm run cli`命令。
- 根据提示输入依赖的名称
- 控制台提示成功后可看到下载完成的目录。


## 批量上传到nexus

- 使用`batch_upload.sh`批量上传 