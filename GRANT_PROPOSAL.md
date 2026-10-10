# Grant Application Proposal: ZK-SecretVault (Phase 2 Upgrade)

## 1. Project Overview

- **Project Name**: ZK-SecretVault
- **Category**: Cryptography, Privacy & Developer Tooling
- **Track**: Zero-Knowledge Reference Architectures & Education
- **Open-Source Repository**: `https://github.com/ajin558/zk-secret-vault`
- **Applicant**: Individual Web3 & Smart Contract Developer (ajin558)
- **Settlement EVM Address**: `0x3dB8636F9C32DeF9D96079A9eCF272E174093A11`
- **Requested Funding**: $10,000 USD (in USDC / ETH across Milestone 2 & 3)

---

## 2. Motivation & Current Milestone 1 Status (Completed)

Zero-Knowledge engineering suffers from a steep barrier to entry: developers lack transparent, end-to-end reference codebases showing how Circom circuits, Ethereum precompile verifiers (`ecpairing`), and in-browser WebAssembly provers interact securely without hiding architectural trade-offs.

**Milestone 1 has been completed and verified as an educational prototype**:
- [x] Circom circuit implementation with **mempool front-running protection** (`recipient` signal constraint).
- [x] End-to-end Groth16 pipeline with local setup, witness generation, and Solidity verifier export.
- [x] Comprehensive Foundry test suite with gas benchmarking and an automated **Under-Constrained Vulnerability PoC**.
- [x] Pure client-side browser demonstration with WebAssembly Groth16 proving.

---

## 3. Honest Disclosures & Why Phase 2 Funding is Required

As disclosed in the repository documentation, the current prototype has intentional scope boundaries that require funding to upgrade to production standards:
1. **Anonymity Set**: Current implementation operates as a 1:1 pairwise voucher scheme. **Phase 2 will integrate an on-chain incremental Merkle Tree accumulator (Depth 20)**, decoupling deposits from withdrawals into an $N$-depositor anonymity pool (Tornado/Semaphore style).
2. **Ceremony Security**: Current Groth16 keys were produced using local deterministic entropy for reproducible testing. **Phase 2 will migrate to universal setup (Plonk) or integrate with the perpetual Ethereum Powers of Tau ceremony**.
3. **Decentralized Relay**: Enabling gasless redemptions so recipients without initial ETH can withdraw funds via an open-source relayer network.

---

## 4. Development Roadmap & Milestones

### Milestone 2: Merkle Tree Anonymity Accumulator & Multi-Chain Testnet ($5,000 USD)
- **Duration**: 4 Weeks
- **Deliverables**:
  1. Upgrade `VaultWithdrawal` circuit with Merkle Tree inclusion proofs (Poseidon sponge, 20 levels).
  2. Implement an on-chain incremental Merkle Tree contract in Solidity.
  3. Deploy verified contracts to Sepolia and Arbitrum Sepolia testnets with interactive web UI.
  4. Publish a comprehensive technical tutorial breaking down ZK security trade-offs.

### Milestone 3: Relayer Network, Fuzzing & Open SDK ($5,000 USD)
- **Duration**: 4 Weeks
- **Deliverables**:
  1. Implement an open-source decentralized Relayer client for gasless meta-transactions (EIP-712).
  2. Circuit constraint fuzzing and invariant testing using Foundry and Halmos.
  3. Publish an open-source TypeScript SDK (`@zk-secretvault/sdk`) for integration into DAOs and payroll tooling.

---

## 5. Budget Allocation

| Item | Allocation | Description |
| :--- | :--- | :--- |
| **Merkle Tree Circuit & Accumulator** | $3,500 | Arithmetization, on-chain tree contract, gas optimization |
| **Relayer Subsystem & SDK** | $3,500 | Meta-transactions, relayer client, developer SDK |
| **Testnet Deployment & Docs** | $1,500 | Public testnet verification, developer guide, tutorial |
| **Invariant Testing & Fuzzing** | $1,500 | Property-based testing, constraint validation |
| **Total** | **$10,000 USD** | Settlement: `0x3dB8636F9C32DeF9D96079A9eCF272E174093A11` |

---

## 6. Public Goods Commitment

All code produced under this grant is released under the **GNU General Public License v3.0 (GPL-3.0)**, ensuring unrestricted access for builders across the Ethereum ecosystem.
