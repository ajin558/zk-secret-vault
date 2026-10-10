// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Verifier.sol";
import "../src/ZKSecretVault.sol";

contract ZKSecretVaultTest is Test {
    Groth16Verifier public verifier;
    ZKSecretVault public vault;

    address payable public alice = payable(address(0xA11CE));
    // Bob 地址必须与 pipeline 生成证明时绑定的 recipient 一致
    address payable public bob = payable(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC);
    address payable public eve = payable(address(0xE0E)); // 恶意抢跑者

    uint[2] a;
    uint[2][2] b;
    uint[2] c;
    uint256 commitment;
    uint256 nullifierHash;

    function setUp() public {
        verifier = new Groth16Verifier();
        vault = new ZKSecretVault(address(verifier));

        vm.deal(alice, 10 ether);
        vm.deal(bob, 0 ether);
        vm.deal(eve, 0 ether);

        // 读取由流水线生成的真实 ZK 证明数据
        string memory root = vm.projectRoot();
        string memory path = string.concat(root, "/build/solidity_calldata.json");
        string memory json = vm.readFile(path);

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
     * @notice 正向测试：合法零知识证明 + 正确绑定收款人成功提款
     */
    function test_ValidZKProof_WithdrawSuccess() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}(commitment);
        assertEq(address(vault).balance, 1 ether);

        // 提款给证明所绑定的合法接收人 Bob
        vault.withdraw(a, b, c, nullifierHash, commitment, bob);

        assertEq(address(vault).balance, 0, "vault balance should be 0");
        assertEq(bob.balance, 1 ether, "bob balance should be 1 ether");
        assertTrue(vault.nullifierSpent(nullifierHash), "nullifier should be marked as spent");
    }

    /**
     * @notice 安全测试：Mempool 抢跑拦截测试 (P0 核心修复验证)
     * 证明：攻击者 Eve 即使完全截获了 Bob 的合法证明，尝试提款给自己也必被合约拒绝！
     */
    function test_RevertWhen_FrontRunDifferentRecipient() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}(commitment);

        // Eve 截获 a, b, c, nullifierHash, commitment，企图将收款人改为 Eve
        vm.prank(eve);
        vm.expectRevert(ZKSecretVault.InvalidProof.selector);
        vault.withdraw(a, b, c, nullifierHash, commitment, eve);

        // 确认资金依然安全停留在金库
        assertEq(address(vault).balance, 1 ether);
        assertEq(eve.balance, 0);
    }

    /**
     * @notice 防双花攻击测试：同一证明无法二次提取
     */
    function test_RevertWhen_DoubleSpend() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}(commitment);

        // 第一次合法提款
        vault.withdraw(a, b, c, nullifierHash, commitment, bob);

        // 攻击者尝试用同样的证明二次提款 -> 必须 Revert
        vm.expectRevert(ZKSecretVault.NullifierAlreadySpent.selector);
        vault.withdraw(a, b, c, nullifierHash, commitment, bob);
    }

    /**
     * @notice 防伪造测试：篡改证明数据必须被拒绝
     */
    function test_RevertWhen_ProofTampered() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}(commitment);

        uint[2] memory fakeA = a;
        fakeA[0] = fakeA[0] + 1;

        vm.expectRevert(ZKSecretVault.InvalidProof.selector);
        vault.withdraw(fakeA, b, c, nullifierHash, commitment, bob);
    }
}
