pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

/**
 * @title VaultWithdrawal
 * @notice 零知识暗号金库取款电路
 * 
 * 关键安全机制：
 * 1. 证明拥有 (secret, nullifier) 的原像，对应公开 commitment。
 * 2. 导出 nullifierHash = Poseidon(nullifier) 防双花。
 * 3. 强绑定 recipient (收款人地址)：将其作为公共输入并纳入 R1CS 约束，
 *    彻底防止矿工或 MEV 机器人在内存池 (Mempool) 中复制证明、篡改收款人进行抢跑窃取！
 */
template VaultWithdrawal() {
    // --- 1. 私有信号 (Private Inputs: 仅本地保留，绝不上链) ---
    signal input secret;
    signal input nullifier;

    // --- 2. 公开输入 (Public Inputs: 上链校验) ---
    signal input commitment;
    signal input recipient; // 接收资金的以太坊地址 (转为整数)

    // --- 3. 公开输出 (Public Output: 防双花标记) ---
    signal output nullifierHash;

    // --- 4. 核心数学约束 (Arithmetization) ---
    // (a) 承诺校验：必须严格等于 Poseidon(secret, nullifier)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== nullifier;
    commitment === commitmentHasher.out;

    // (b) 防双花凭据生成
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHash <== nullifierHasher.out;

    // (c) 强制约束 recipient 参与多项式方程 (防抢跑 / 假造收款人)
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

// 明确声明公共输入顺序：[commitment, recipient]
// 注意：Circom 规范中 output 会排在最前面，故链上实际顺序为: [nullifierHash, commitment, recipient]
component main {public [commitment, recipient]} = VaultWithdrawal();
