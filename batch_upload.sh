#!/bin/bash
#tgz文件存放的路径
targetDir=./newtgzs

#这里替换为实际的nexus地址
publishRestful=http://192.168.1.1:8081/service/rest/v1/component?repository=npm-release

echo ">>> 文件所在目录：$targetDir <<<"
dir=$(ls -l $targetDir | awk '/.tgz$/ {print $NF}')

echo ">>>目录：$dir <<<"
cd $targetDir

for file in $dir
do
  echo ">>> $targetDir/$f1le 上传开始 \n"

  #这里替换为管理员账号密码
  ret=`curl -u 账号:密码 -X POST "$publishRestful" -H "Accept: application/json" -H "Content-Type: multipart/form-data" -F "npm.asset=@$file;type=application/x-compressed"`

  echo $ret
  echo ">>> $targetDir/$file 上传完成 \n"
done
