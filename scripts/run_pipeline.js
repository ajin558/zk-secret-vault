const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { buildPoseidon } = require('circomlibjs');

async function main() {
    console.log("=== [ZK Pipeline] 1. 编译 Circom 电路并初始化参数 ===");
    const buildDir = path.join(__dirname, '../build');
    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

    // 检查编译器
    const circomBin = path.join(__dirname, '../bin/circom.exe');
    if (fs.existsSync(circomBin)) {
        console.log("正在使用 local circom 编译器编译 circuits/vault.circom ...");
        execSync(`"${circomBin}" circuits/vault.circom --r1cs --wasm --sym -o "${buildDir}"`, { stdio: 'inherit' });
    } else {
        console.log("未检测到 bin/circom.exe，尝试使用全局 circom 编译器...");
        try {
            execSync(`circom circuits/vault.circom --r1cs --wasm --sym -o "${buildDir}"`, { stdio: 'inherit' });
        } catch (e) {
            console.log("复用已有构建产物 vault.r1cs 与 vault.wasm。");
        }
    }

    console.log("\n=== 2. 初始化密码学凭证与收款人地址绑定 ===");
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // 演示用的随机暗号 (注意：仅在内存中运算，不写入公开 calldata)
    const secret = BigInt("1234567890987654321");
    const nullifier = BigInt("9876543210123456789");

    // 收款人地址 (以太坊 160-bit address，此处演示绑定 Bob 地址)
    const recipientAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const recipientBigInt = BigInt(recipientAddress);

    const commitmentHash = poseidon([secret, nullifier]);
    const commitmentStr = F.toString(commitmentHash);
    const nullifierHash = poseidon([nullifier]);
    const nullifierHashStr = F.toString(nullifierHash);

    console.log(`[公开承诺] Commitment:    ${commitmentStr}`);
    console.log(`[公开防重] NullifierHash: ${nullifierHashStr}`);
    console.log(`[绑定收款] Recipient:     ${recipientAddress} (${recipientBigInt.toString()})`);

    // 电路输入文件 (本地临时计算使用)
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
    console.log("[警告] 本设置仅使用本地随机熵生成，仅供教学演示与本地测试，严禁用于主网资金！");
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

    // 重新根据新电路生成 Circuit zkey
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

    console.log("\n=== 7. 生成仅包含公开验证参数的 Calldata (不含任何私钥/明文) ===");
    const calldataRaw = execSync(`npx snarkjs zkey export soliditycalldata "${publicFile}" "${proofFile}"`).toString().trim();
    const parsedParams = JSON.parse(`[${calldataRaw}]`);

    // 严禁在此存储 secret 或 nullifier 明文！只存供合约验证的公开证明参数
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

    // 自动同步至 frontend/circuit/ 供本地 DApp 前端直接调用
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

    console.log("\n流水线执行完毕！");
}

main().catch(err => {
    console.error("执行出错:", err);
    process.exit(1);
});
