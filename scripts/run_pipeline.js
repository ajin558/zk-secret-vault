const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { buildPoseidon } = require('circomlibjs');

async function main() {
    console.log("=== 1. 初始化 Poseidon 哈希与测试凭证 ===");
    const poseidon = await buildPoseidon();
    const F = poseidon.F; // 有限域工具

    // 秘密密码 (原像) - 只有用户知道，外界绝对不可见
    const secret = BigInt("1234567890987654321");
    // 随机数 (Nullifier) - 每次提款唯一
    const nullifier = BigInt("9876543210123456789");

    // 计算链上公开承诺：commitment = Poseidon(secret, nullifier)
    const commitmentHash = poseidon([secret, nullifier]);
    const commitmentStr = F.toString(commitmentHash);

    // 计算公开防双花标识：nullifierHash = Poseidon(nullifier)
    const nullifierHash = poseidon([nullifier]);
    const nullifierHashStr = F.toString(nullifierHash);

    console.log(`[私有明文] Secret:        ${secret}`);
    console.log(`[私有明文] Nullifier:     ${nullifier}`);
    console.log(`[公开承诺] Commitment:    ${commitmentStr}`);
    console.log(`[公开防重] NullifierHash: ${nullifierHashStr}`);

    const inputData = {
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        commitment: commitmentStr
    };

    fs.writeFileSync(
        path.join(__dirname, '../build/input.json'),
        JSON.stringify(inputData, null, 2)
    );
    console.log("已生成 build/input.json");

    console.log("\n=== 2. 执行 Groth16 Trusted Setup (Powers of Tau) ===");
    const buildDir = path.join(__dirname, '../build');
    const ptau0 = path.join(buildDir, 'pot12_0000.ptau');
    const ptau1 = path.join(buildDir, 'pot12_0001.ptau');
    const ptauFinal = path.join(buildDir, 'pot12_final.ptau');

    if (!fs.existsSync(ptauFinal)) {
        console.log("生成本地通用仪式参数 (PTAU power 12)...");
        execSync(`npx snarkjs powersoftau new bn128 12 "${ptau0}" -v`, { stdio: 'inherit' });
        execSync(`npx snarkjs powersoftau contribute "${ptau0}" "${ptau1}" --name="First Contribution" -v -e="entropy_demo_seed_123"`, { stdio: 'inherit' });
        execSync(`npx snarkjs powersoftau prepare phase2 "${ptau1}" "${ptauFinal}" -v`, { stdio: 'inherit' });
    } else {
        console.log("复用已有 PTAU 参数。");
    }

    console.log("\n=== 3. 电路专属设置 (Circuit ZKey) ===");
    const r1cs = path.join(buildDir, 'vault.r1cs');
    const zkey0 = path.join(buildDir, 'vault_0000.zkey');
    const zkeyFinal = path.join(buildDir, 'vault_final.zkey');

    if (!fs.existsSync(zkeyFinal)) {
        execSync(`npx snarkjs groth16 setup "${r1cs}" "${ptauFinal}" "${zkey0}"`, { stdio: 'inherit' });
        execSync(`npx snarkjs zkey contribute "${zkey0}" "${zkeyFinal}" --name="Lab Contributor" -v -e="entropy_circuit_seed_456"`, { stdio: 'inherit' });
    } else {
        console.log("复用已有 Circuit ZKey。");
    }

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

    console.log("\n=== 7. 生成 Solidity 调用 Calldata ===");
    const calldataRaw = execSync(`npx snarkjs zkey export soliditycalldata "${publicFile}" "${proofFile}"`).toString().trim();
    console.log("Solidity Calldata:");
    console.log(calldataRaw);

    // 将解析后的调用参数保存为 JSON，方便 Foundry 自动化测试加载
    const parsedParams = JSON.parse(`[${calldataRaw}]`);
    const calldataData = {
        a: parsedParams[0],
        b: parsedParams[1],
        c: parsedParams[2],
        input: parsedParams[3],
        raw: calldataRaw,
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        commitment: commitmentStr,
        nullifierHash: nullifierHashStr
    };

    fs.writeFileSync(
        path.join(buildDir, 'solidity_calldata.json'),
        JSON.stringify(calldataData, null, 2)
    );
    console.log("已将链上测试参数保存至 build/solidity_calldata.json");
    console.log("\n流水线执行完毕！全部资产与证明已齐备。");
}

main().catch(err => {
    console.error("执行出错:", err);
    process.exit(1);
});
