pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

/**
 * @title VulnerableVaultWithdrawal (经典“漏约束”致命漏洞电路)
 * @notice 这是一个在真实 Web3 审计中价值几十万美元的真实漏洞模型：
 * 开发者在写电路时，误将约束符号 === 漏写，或者把信号仅做了赋值。
 */
template VulnerableVaultWithdrawal() {
    signal input secret;
    signal input nullifier;
    signal input commitment;
    signal output nullifierHash;

    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== nullifier;

    // =========================================================================
    // 【致命漏洞 (Under-constrained Vulnerability)】:
    // 开发者忘记了写这行强制约束：
    // commitment === commitmentHasher.out;
    //
    // 后果：commitment 信号完全没有参与任何代数方程约束！
    // 攻击者输入任意伪造的 secret (哪怕是 0)，只要把公开信号填上受害者的 commitment，
    // 整个多项式系统依然恒成立，从而能伪造出让以太坊合约完全信以为真的 Proof！
    // =========================================================================

    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;

    nullifierHash <== nullifierHasher.out;
}

component main {public [commitment]} = VulnerableVaultWithdrawal();
