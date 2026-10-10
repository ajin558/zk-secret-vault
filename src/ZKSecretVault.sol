// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Verifier 接口 (输入为 3 个公共信号: [nullifierHash, commitment, recipient])
 */
interface IGroth16Verifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[3] calldata input
    ) external view returns (bool r);
}

/**
 * @title ZKSecretVault (零知识暗号金库 - 教学实验原型)
 * @dev 【免责声明与安全警告】
 * 本合约仅供教学演示与密码学原理研究使用。
 * 1. 采用本地单方 Groth16 Trusted Setup 仪式，无真实安全假设，严禁用于以太坊主网任何真实资产！
 * 2. 属于 1:1 零知识暗号承兑原型；如需多用户匿名隐私池，需升级为 Merkle Tree 树状成员证明。
 */
contract ZKSecretVault {
    IGroth16Verifier public immutable verifier;
    uint256 public constant DENOMINATION = 1 ether;

    // 重入锁状态变量
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // 记录已存入的承诺
    mapping(uint256 => bool) public commitments;
    // 记录已被消费的 nullifierHash，防止双花
    mapping(uint256 => bool) public nullifierSpent;

    event Deposit(uint256 indexed commitment, uint256 timestamp);
    event Withdraw(address indexed recipient, uint256 nullifierHash);

    error InvalidDepositAmount();
    error InvalidProof();
    error CommitmentAlreadyExists();
    error CommitmentNotFound();
    error NullifierAlreadySpent();
    error TransferFailed();
    error ReentrancyGuardReentrantCall();

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrancyGuardReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(address _verifier) {
        verifier = IGroth16Verifier(_verifier);
        _status = _NOT_ENTERED;
    }

    /**
     * @notice 存款：任何人存入 1 ETH 并登记 commitment
     */
    function deposit(uint256 commitment) external payable {
        if (msg.value != DENOMINATION) revert InvalidDepositAmount();
        if (commitments[commitment]) revert CommitmentAlreadyExists();

        commitments[commitment] = true;
        emit Deposit(commitment, block.timestamp);
    }

    /**
     * @notice 零知识提款
     * @dev recipient 必须作为公共信号传入验证合约，证明参数与收款人强绑定，杜绝内存池抢跑！
     */
    function withdraw(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint256 nullifierHash,
        uint256 commitment,
        address payable recipient
    ) external nonReentrant {
        // 1. 检查承诺是否存在
        if (!commitments[commitment]) revert CommitmentNotFound();

        // 2. 检查防双花状态
        if (nullifierSpent[nullifierHash]) revert NullifierAlreadySpent();

        // 3. 将 recipient 转换为 uint256 作为第 3 个公共输入，强制与电路绑定
        uint[3] memory publicInputs = [
            nullifierHash,
            commitment,
            uint256(uint160(address(recipient)))
        ];

        bool isValid = verifier.verifyProof(a, b, c, publicInputs);
        if (!isValid) revert InvalidProof();

        // 4. 更新状态 (遵循 CEI 原则)
        nullifierSpent[nullifierHash] = true;

        // 5. 放款
        (bool success, ) = recipient.call{value: DENOMINATION}("");
        if (!success) revert TransferFailed();

        emit Withdraw(recipient, nullifierHash);
    }
}
