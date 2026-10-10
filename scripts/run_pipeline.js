const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { buildPoseidon } = require('circomlibjs');

// 跨平台自动下载对应操作系统版本的 Circom 二进制文件
function downloadCircom(destPath) {
    const platform = process.platform;
    let binaryName = '';
    if (platform === 'win32') {
        binaryName = 'circom-windows-amd64.exe';
    } else if (platform === 'darwin') {
        binaryName = 'circom-macos-amd64';
    } else if (platform === 'linux') {
        binaryName = 'circom-linux-amd64';
    } else {
        throw new Error(`不支持的操作系统架构: ${platform}`);
    }

    const downloadUrl = `https://github.com/iden3/circom/releases/download/v2.1.6/${binaryName}`;
    console.log(`[Circom 下载] 正在从 GitHub Release 下载官方 Circom v2.1.6 (${binaryName})...`);

    const downloadWithRedirect = (url, target) => {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return downloadWithRedirect(res.headers.location, target).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`下载失败，HTTP 状态码: ${res.statusCode}`));
                }
                const fileStream = fs.createWriteStream(target);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        if (platform !== 'win32') {
                            fs.chmodSync(target, 0o755);
                        }
                        resolve(target);
                    });
                });
            }).on('error', reject);
        });
    };

    return downloadWithRedirect(downloadUrl, destPath);
}

async function ensureCircomCompiler() {
    // 1. 优先检查系统全局是否已安装 circom
    try {
        execSync('circom --version', { stdio: 'ignore' });
        console.log("[Circom] 检测到系统全局已安装 circom，优先使用全局编译器。");
        return 'circom';
    } catch (e) {}

    // 2. 检查本地 bin 目录
    const binDir = path.join(__dirname, '../bin');
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    const localBin = path.join(binDir, process.platform === 'win32' ? 'circom.exe' : 'circom');
    if (fs.existsSync(localBin)) {
        console.log(`[Circom] 使用本地编译器: ${localBin}`);
        return localBin;
    }

    // 3. 自动下载
    console.log("[Circom] 未检测到 Circom 编译器，正在全自动下载安装官方发布版...");
    await downloadCircom(localBin);
    console.log(`[Circom] 下载完成，已就绪: ${localBin}`);
    return localBin;
}

async function main() {
    console.log("=== [ZK Pipeline] 0. 环境就绪与编译器检查 ===");
    const circomCmd = await ensureCircomCompiler();

    console.log("\n=== 1. 编译 Circom 电路并导出 R1CS 与 WASM ===");
    const buildDir = path.join(__dirname, '../build');
    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

    const circuitPath = path.join(__dirname, '../circuits/vault.circom');
    execSync(`"${circomCmd}" "${circuitPath}" --r1cs --wasm --sym -o "${buildDir}"`, { stdio: 'inherit' });

    console.log("\n=== 2. 初始化密码学凭证与收款人地址绑定 ===");
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // 演示用的暗号 (内存运算，绝不写入公开 calldata)
    const secret = BigInt("1234567890987654321");
    const nullifier = BigInt("9876543210123456789");

    // 收款人地址 (以太坊 160-bit address，演示绑定测试地址)
    const recipientAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const recipientBigInt = BigInt(recipientAddress);

    const commitmentHash = poseidon([secret, nullifier]);
    const commitmentStr = F.toString(commitmentHash);
    const nullifierHash = poseidon([nullifier]);
    const nullifierHashStr = F.toString(nullifierHash);

    console.log(`[公开承诺] Commitment:    ${commitmentStr}`);
    console.log(`[公开防重] NullifierHash: ${nullifierHashStr}`);
    console.log(`[绑定收款] Recipient:     ${recipientAddress} (${recipientBigInt.toString()})`);

    const inputData = {
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        commitment: commitmentStr,
        recipient: recipientBigInt.toString()
    };

    fs.writeFileSync(
        path.join(buildDir, 'input.json'),
        JSON.stringify(inputData, null, 2)
    );

    console.log("\n=== 3. 执行 Groth16 Trusted Setup ===");
    console.log("[免责声明] 本设置使用本地随机熵生成，仅供教学演示与离线单元测试，严禁用于主网资金！");
    const ptau0 = path.join(buildDir, 'pot12_0000.ptau');
    const ptau1 = path.join(buildDir, 'pot12_0001.ptau');
    const ptauFinal = path.join(buildDir, 'pot12_final.ptau');

    if (!fs.existsSync(ptauFinal)) {
        console.log("生成本地通用仪式参数 (PTAU power 12)...");
        execSync(`npx snarkjs powersoftau new bn128 12 "${ptau0}" -v`, { stdio: 'inherit' });
        execSync(`npx snarkjs powersoftau contribute "${ptau0}" "${ptau1}" --name="Local Dev" -v -e="entropy_local_dev_${Date.now()}"`, { stdio: 'inherit' });
        execSync(`npx snarkjs powersoftau prepare phase2 "${ptau1}" "${ptauFinal}" -v`, { stdio: 'inherit' });
    }

    const r1cs = path.join(buildDir, 'vault.r1cs');
    const zkey0 = path.join(buildDir, 'vault_0000.zkey');
    const zkeyFinal = path.join(buildDir, 'vault_final.zkey');

    execSync(`npx snarkjs groth16 setup "${r1cs}" "${ptauFinal}" "${zkey0}"`, { stdio: 'inherit' });
    execSync(`npx snarkjs zkey contribute "${zkey0}" "${zkeyFinal}" --name="Local Contributor" -v -e="entropy_circuit_${Date.now()}"`, { stdio: 'inherit' });

    console.log("\n=== 4. 导出验证密钥与 Solidity 验证合约 ===");
    const vkey = path.join(buildDir, 'verification_key.json');
    execSync(`npx snarkjs zkey export verificationkey "${zkeyFinal}" "${vkey}"`, { stdio: 'inherit' });

    const verifierSol = path.join(__dirname, '../src/Verifier.sol');
    execSync(`npx snarkjs zkey export solidityverifier "${zkeyFinal}" "${verifierSol}"`, { stdio: 'inherit' });
    console.log(`已成功生成智能合约: src/Verifier.sol`);

    console.log("\n=== 5. 生成见证人 (Witness) 与零知识证明 (Proof) ===");
    const wasm = path.join(buildDir, 'vault_js/vault.wasm');
    const witnessCalc = path.join(buildDir, 'vault_js/generate_witness.js');
    const witnessFile = path.join(buildDir, 'witness.wtns');
    const inputJson = path.join(buildDir, 'input.json');
    const proofFile = path.join(buildDir, 'proof.json');
    const publicFile = path.join(buildDir, 'public.json');

    execSync(`node "${witnessCalc}" "${wasm}" "${inputJson}" "${witnessFile}"`, { stdio: 'inherit' });
    execSync(`npx snarkjs groth16 prove "${zkeyFinal}" "${witnessFile}" "${proofFile}" "${publicFile}"`, { stdio: 'inherit' });

    console.log("\n=== 6. 链下数学检验 (Off-chain Verification) ===");
    execSync(`npx snarkjs groth16 verify "${vkey}" "${publicFile}" "${proofFile}"`, { stdio: 'inherit' });
    console.log("链下零知识数学验证通过！[OK]");

    console.log("\n=== 7. 生成仅包含公开验证参数的 Calldata (不含任何明文私密信息) ===");
    const calldataRaw = execSync(`npx snarkjs zkey export soliditycalldata "${publicFile}" "${proofFile}"`).toString().trim();
    const parsedParams = JSON.parse(`[${calldataRaw}]`);

    const calldataData = {
        a: parsedParams[0],
        b: parsedParams[1],
        c: parsedParams[2],
        input: parsedParams[3],
        raw: calldataRaw,
        commitment: commitmentStr,
        nullifierHash: nullifierHashStr,
        recipient: recipientBigInt.toString(),
        recipientAddress: recipientAddress
    };

    fs.writeFileSync(
        path.join(buildDir, 'solidity_calldata.json'),
        JSON.stringify(calldataData, null, 2)
    );
    console.log("公开验证参数已保存至 build/solidity_calldata.json (不含任何明文私密信息)");

    // 自动同步至 frontend/circuit/ 供前端直接调用
    const frontendCircuitDir = path.join(__dirname, '../frontend/circuit');
    if (!fs.existsSync(frontendCircuitDir)) fs.mkdirSync(frontendCircuitDir, { recursive: true });
    fs.copyFileSync(wasm, path.join(frontendCircuitDir, 'vault.wasm'));
    fs.copyFileSync(zkeyFinal, path.join(frontendCircuitDir, 'vault_final.zkey'));
    console.log("已将新版 WASM 与 ZKey 同步至 frontend/circuit/ 供前端直接运算。");

    // 清理含私密输入的临时 input.json
    if (fs.existsSync(inputJson)) {
        fs.unlinkSync(inputJson);
        console.log("已清理临时本地 input.json 文件。");
    }

    console.log("\n流水线执行完毕！[ALL SUCCESS]");
}

main().catch(err => {
    console.error("执行出错:", err);
    process.exit(1);
});
