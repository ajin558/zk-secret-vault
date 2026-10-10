pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

/**
 * @title VaultWithdrawal
 * @notice 零知识暗号金库取款电路
 *
 * 目标：
 * 证明者在【完全不暴露 secret 和 nullifier 明文】的前提下，向智能合约证明：
 * 1. 证明者掌握一对秘密 (secret, nullifier)，其 Poseidon 哈希等于公开的 commitment。
 * 2. 计算出 nullifierHash = Poseidon(nullifier)，供智能合约记录防双花标记。
 */
template VaultWithdrawal() {
    // --- 1. 私有信号 (Private Inputs: 链下保留，链上全盲) ---
    signal input secret;
    signal input nullifier;

    // --- 2. 公开输入 (Public Input: 链上已知并校验) ---
    signal input commitment;

    // --- 3. 公开输出 (Public Output: 传给智能合约做防双花) ---
    signal output nullifierHash;

    // --- 4. 约束逻辑 (Arithmetization / R1CS) ---
    // (a) 验证承诺哈希：计算 Poseidon(secret, nullifier)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== nullifier;

    // 必须强约束计算结果与公开承诺完全一致
    // "===" 是 ZK 的灵魂，它生成 R1CS 约束 (A * B = C)，如果不等则证明生成失败或无法被合约验证
    commitment === commitmentHasher.out;

    // (b) 生成 nullifierHash 用于防重放
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;

    nullifierHash <== nullifierHasher.out;
}

// 声明主组件，显式指定公开输入
component main {public [commitment]} = VaultWithdrawal();
