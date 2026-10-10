// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGroth16Verifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[2] calldata input
    ) external view returns (bool r);
}

/**
 * @title ZKSecretVault (零知识暗号金库)
 * @notice 用户存入资金时提交公开哈希 commitment = Poseidon(secret, nullifier)
 *         提款时，用户出具零知识证明，证明自己知道 secret，同时公布 nullifierHash = Poseidon(nullifier) 防双花。
 *         全网（包括验证合约和区块打包者）自始至终无法窥探用户的 secret 明文！
 */
contract ZKSecretVault {
    IGroth16Verifier public immutable verifier;
    uint256 public constant DENOMINATION = 1 ether;

    // 记录已存入的承诺
    mapping(uint256 => bool) public commitments;
    // 记录已被消费的 nullifierHash，防止双花攻击 (Double-spending)
    mapping(uint256 => bool) public nullifierSpent;

    event Deposit(uint256 indexed commitment, uint256 timestamp);
    event Withdraw(address indexed recipient, uint256 nullifierHash);

    error InvalidProof();
    error CommitmentAlreadyExists();
    error CommitmentNotFound();
    error NullifierAlreadySpent();
    error TransferFailed();

    constructor(address _verifier) {
        verifier = IGroth16Verifier(_verifier);
    }

    /**
     * @notice 存款：任何人都可以存入 1 ETH 并登记一个 commitment
     */
    function deposit(uint256 commitment) external payable {
        require(msg.value == DENOMINATION, "Must deposit exactly 1 ETH");
        if (commitments[commitment]) revert CommitmentAlreadyExists();

        commitments[commitment] = true;
        emit Deposit(commitment, block.timestamp);
    }

    /**
     * @notice 零知识匿名提款
     * @param a 证明参数 a
     * @param b 证明参数 b
     * @param c 证明参数 c
     * @param nullifierHash 防双花标识 (电路输出)
     * @param commitment 承诺标识 (电路输入)
     * @param recipient 接收款项的地址
     */
    function withdraw(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint256 nullifierHash,
        uint256 commitment,
        address payable recipient
    ) external {
        // 1. 检查承诺是否存在
        if (!commitments[commitment]) revert CommitmentNotFound();

        // 2. 检查是否已被消费 (防双花)
        if (nullifierSpent[nullifierHash]) revert NullifierAlreadySpent();

        // 3. 校验零知识证明 (输入顺序必须与电路声明一致: [nullifierHash, commitment])
        uint[2] memory publicInputs = [nullifierHash, commitment];
        bool isValid = verifier.verifyProof(a, b, c, publicInputs);
        if (!isValid) revert InvalidProof();

        // 4. 状态变更：标记已消费 (遵循 Checks-Effects-Interactions 模式)
        nullifierSpent[nullifierHash] = true;

        // 5. 放款
        (bool success, ) = recipient.call{value: DENOMINATION}("");
        if (!success) revert TransferFailed();

        emit Withdraw(recipient, nullifierHash);
    }
}
