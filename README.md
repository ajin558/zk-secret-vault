# ZK-SecretVault: Trustless On-Chain Privacy Vault with Groth16 & WebAssembly

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Foundry](https://img.shields.io/badge/Foundry-Passing-brightgreen)](https://getfoundry.sh/)
[![Circom](https://img.shields.io/badge/Circom-2.2.3-orange)](https://github.com/iden3/circom)
[![SnarkJS](https://img.shields.io/badge/SnarkJS-Groth16-purple)](https://github.com/iden3/snarkjs)

**ZK-SecretVault** is a privacy-preserving decentralized custody and anonymous redemption protocol. It enables depositors to register cryptographic commitments on-chain and redeem funds anonymously using client-side Zero-Knowledge Proofs (ZKPs) without exposing preimages, plaintexts, or private keys to the mempool or miners.

---

## 🚀 Key Features

- **100% Client-Side Privacy Proof**: Proofs are synthesized in the browser in **< 150ms** via WebAssembly (WASM). No trusted relayer or centralized backend needed.
- **Poseidon Hash Arithmetization**: Leverages the SNARK-friendly Poseidon sponge construction over the BN254 scalar field ($GF(p)$), minimizing R1CS gate count.
- **Anti-Double-Spend Nullifier Mechanism**: Enforces cryptographic one-time redemption using nullifier commitments (`nullifierHash = Poseidon(nullifier)`).
- **EIP-197 Gas Optimization**: Uses Ethereum precompiled contract `0x08` (`ecpairing`) for on-chain proof verification (~195k gas).
- **Audited Vulnerability PoC Suite**: Includes automated Foundry PoCs demonstrating protections against common ZK pitfalls (e.g., **Under-constrained circuits**).

---

## 🏛️ System Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Alice (Depositor)
    actor Bob as Bob (Anonymous Recipient)
    participant Browser as Client Browser (WASM)
    participant Contract as ZKSecretVault.sol
    participant Verifier as Groth16Verifier.sol (Precompile 0x08)

    Alice->>Browser: Enter Secret + Nullifier
    Browser->>Browser: Compute commitment = Poseidon(secret, nullifier)
    Alice->>Contract: deposit(commitment) with 1 ETH
    Note over Contract: Stores commitment on-chain

    Bob->>Browser: Input secret + nullifier
    Browser->>Browser: snarkjs.groth16.fullProve() in WASM (~120ms)
    Note over Browser: Synthesizes π_a, π_b, π_c & nullifierHash
    Bob->>Contract: withdraw(π, nullifierHash, commitment, Bob)
    Contract->>Contract: Check nullifierSpent[nullifierHash] == false
    Contract->>Verifier: verifyProof(π, [nullifierHash, commitment])
    Verifier-->>Contract: Pairing Valid (true)
    Contract->>Contract: Mark nullifierSpent = true
    Contract->>Bob: Transfer 1 ETH
```

---

## 📊 Circuit & Gas Benchmark

### Circom Circuit Metrics (`VaultWithdrawal`)
| Metric | Value |
| :--- | :--- |
| **Compiler** | Circom 2.2.3 |
| **Proving System** | Groth16 (BN254 curve) |
| **Non-Linear Constraints** | 459 |
| **Linear Constraints** | 473 |
| **Wires** | 935 |
| **Public Inputs / Outputs** | 1 Input (`commitment`), 1 Output (`nullifierHash`) |
| **Browser Proving Time** | ~110 ms (Intel/Apple Silicon) |

### Smart Contract Execution Benchmarks (Foundry Local EVM)
| Function | Gas Used | Description |
| :--- | :--- | :--- |
| `deposit()` | **46,079** | Registers commitment & stores funds |
| `withdraw()` | **261,703** | Full verification + anti-double-spend + 1 ETH payout |
| `ecpairing` verification | **195,775** | Underlying precompile `0x08` check |

---

## 🛡️ Built-in Security & Audit Test Suite

In ZK circuits, **Under-constrained vulnerabilities** (missing constraints) represent over 70% of high-severity audit findings in Web3.

This repository includes a dedicated exploit test suite ([`test/UnderConstrainedExploit.t.sol`](test/UnderConstrainedExploit.t.sol)) that proves:
1. Omitting `commitment === commitmentHasher.out` allows an attacker with `secret = 0` to forge valid proofs and drain funds.
2. The production circuit strictly enforces all intermediate signals, ensuring strict computational determinism.

Run all tests via Foundry:
```bash
forge test -vvv
```

Output:
```text
Ran 2 test suites in 8.55ms: 4 tests passed, 0 failed, 0 skipped
[PASS] test_ValidZKProof_WithdrawSuccess() (gas: 359859)
[PASS] test_RevertWhen_DoubleSpend() (gas: 421088)
[PASS] test_RevertWhen_ProofTampered() (gas: 1024198919)
[PASS] test_AuditPoC_UnderConstrainedDrainVault() (gas: 356057)
```

---

## 🛠️ Quickstart Guide

### Prerequisites
- Node.js >= 18
- Foundry (`forge` and `anvil`)
- Circom 2.2+ (executable included in `bin/`)

### 1. Installation
```bash
git clone https://github.com/ajin558/zk-secret-vault.git
cd zk-secret-vault
npm install
```

### 2. Compile Circuit & Generate Verifier
```bash
node scripts/run_pipeline.js
```

### 3. Run Foundry Test Suite
```bash
forge test -vvv
```

### 4. Launch Local Interactive DApp
```bash
node server.js
```
Open **`http://localhost:3000`** in your browser to experience client-side proving and trustless withdrawals.

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
