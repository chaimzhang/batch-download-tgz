import {exec, ExecException} from "child_process";

require("fix-esm").register();
import inquirer from 'inquirer';
import fs from 'fs';
import {start} from "./download";
import dayjs from "dayjs";
import path from "path";

const rootDir = '.dependencies';
if (!fs.existsSync(rootDir)) {
    fs.mkdirSync(rootDir)
}

function useExec(cmd: string, cwd: string = './') {
    return new Promise((resolve, reject) => {
        exec(cmd, {cwd}, (error: ExecException | null, stdout: string) => {
            if (error) {
                debugger
                reject(error)
            } else {
                resolve(stdout);
            }
        })
    })
}


inquirer.prompt([
    {
        type: 'input',
        name: 'dependencies_name',
        message: '请输入依赖名称或名称@版本，多个请使用空格分开...\n',
    }
]).then((answers: { dependencies_name: string }) => {
    const {dependencies_name} = answers;

    const dir = `${rootDir}/${dayjs().format('YYYYMMDD_HHmmss')}`;

    fs.mkdirSync(dir)

    useExec(`npm init -y`, dir)
        .then(() => useExec(`npm i ${dependencies_name} --package-lock-only`, dir)
            .then(() => start(`${dir}/`, () => {
                console.log(`依赖包文件存储路径为${path.resolve(`${dir}/tgzs/`)}`)
            }))
        )
});
