// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Verifier.sol";
import "../src/ZKSecretVault.sol";

contract ZKSecretVaultTest is Test {
    Groth16Verifier public verifier;
    ZKSecretVault public vault;

    address payable public alice = payable(address(0xA11CE));
    address payable public bob = payable(address(0xB0B));

    // 从 build/solidity_calldata.json 加载的参数
    uint[2] a;
    uint[2][2] b;
    uint[2] c;
    uint256 commitment;
    uint256 nullifierHash;

    function setUp() public {
        verifier = new Groth16Verifier();
        vault = new ZKSecretVault(address(verifier));

        // 给测试账户注资虚拟测试币 (0成本，本地模拟)
        vm.deal(alice, 10 ether);
        vm.deal(bob, 0 ether);

        // 读取由流水线生成的真实 ZK 证明数据
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/build/solidity_calldata.json");
        string memory json = vm.readFile(path);

        // 解析参数
        a[0] = vm.parseJsonUint(json, ".a[0]");
        a[1] = vm.parseJsonUint(json, ".a[1]");

        b[0][0] = vm.parseJsonUint(json, ".b[0][0]");
        b[0][1] = vm.parseJsonUint(json, ".b[0][1]");
        b[1][0] = vm.parseJsonUint(json, ".b[1][0]");
        b[1][1] = vm.parseJsonUint(json, ".b[1][1]");

        c[0] = vm.parseJsonUint(json, ".c[0]");
        c[1] = vm.parseJsonUint(json, ".c[1]");

        commitment = vm.parseJsonUint(json, ".commitment");
        nullifierHash = vm.parseJsonUint(json, ".nullifierHash");
    }

    /**
     * @notice 核心正向测试：合法的零知识证明成功提款
     * 证明者完全不需要向合约透露任何 secret 明文！
     */
    function test_ValidZKProof_WithdrawSuccess() public {
        // 1. Alice 存款 1 ETH 并登记承诺
        vm.prank(alice);
        vault.deposit{value: 1 ether}(commitment);
        assertEq(address(vault).balance, 1 ether);

        // 2. Bob 持有合法 Proof 提款到自己的地址
        vm.prank(bob);
        vault.withdraw(a, b, c, nullifierHash, commitment, bob);

        // 3. 断言资金划转与状态变更
        assertEq(address(vault).balance, 0, "vault balance should be 0");
        assertEq(bob.balance, 1 ether, "bob balance should be 1 ether");
        assertTrue(vault.nullifierSpent(nullifierHash), "nullifier should be marked as spent");
    }

    /**
     * @notice 防双花攻击测试：同一证明无法二次提取
     */
    function test_RevertWhen_DoubleSpend() public {
        // 1. 存入 2 个承诺 (假设金库里有 2 ETH)
        vm.prank(alice);
        vault.deposit{value: 1 ether}(commitment);

        // 2. 第一次提款成功
        vault.withdraw(a, b, c, nullifierHash, commitment, bob);

        // 3. 攻击者尝试用同样的证明二次提款 -> 必须 Revert
        vm.expectRevert(ZKSecretVault.NullifierAlreadySpent.selector);
        vault.withdraw(a, b, c, nullifierHash, commitment, bob);
    }

    /**
     * @notice 防伪造测试：篡改证明数据必须被拒绝
     */
    function test_RevertWhen_ProofTampered() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}(commitment);

        // 篡改证明的 a[0] 点坐标
        uint[2] memory fakeA = a;
        fakeA[0] = fakeA[0] + 1;

        vm.expectRevert(ZKSecretVault.InvalidProof.selector);
        vault.withdraw(fakeA, b, c, nullifierHash, commitment, bob);
    }
}
