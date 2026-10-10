const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ethers } = require('ethers');
const { buildPoseidon } = require('circomlibjs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

let anvilProcess = null;
let provider = null;
let deployerWallet = null;
let aliceWallet = null;
let bobWallet = null;

let verifierContract = null;
let vaultContract = null;
let poseidon = null;

const RPC_URL = 'http://127.0.0.1:8545';

// 启动并连接 Anvil 本地节点
async function ensureAnvilRunning() {
    try {
        const testProvider = new ethers.JsonRpcProvider(RPC_URL);
        await testProvider.getBlockNumber();
        console.log("[Anvil] 检测到已有 Anvil 节点运行在 8545 端口。");
    } catch (e) {
        console.log("[Anvil] 未检测到运行中的节点，正在自动启动本地 Anvil...");
        anvilProcess = spawn('anvil', ['--port', '8545', '--silent'], {
            detached: false,
            stdio: 'ignore',
            shell: true
        });
        // 等待节点就绪
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            try {
                const testProvider = new ethers.JsonRpcProvider(RPC_URL);
                await testProvider.getBlockNumber();
                console.log("[Anvil] 本地节点启动并连接成功！");
                break;
            } catch (err) {}
        }
    }

    provider = new ethers.JsonRpcProvider(RPC_URL);
    // 优先读取环境变量私钥，本地测试网 (Anvil/Hardhat) 未配置时回退至官方标准公开测试私钥
    const isLocalNode = RPC_URL.includes("127.0.0.1") || RPC_URL.includes("localhost");
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || (isLocalNode ? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" : null);
    const aliceKey = process.env.ALICE_PRIVATE_KEY || (isLocalNode ? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" : null);
    const bobKey = process.env.BOB_PRIVATE_KEY || (isLocalNode ? "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" : null);

    if (!deployerKey) {
        throw new Error("Missing DEPLOYER_PRIVATE_KEY environment variable for non-local network.");
    }

    deployerWallet = new ethers.Wallet(deployerKey, provider);
    aliceWallet = aliceKey ? new ethers.Wallet(aliceKey, provider) : null;
    bobWallet = bobKey ? new ethers.Wallet(bobKey, provider) : null;
    console.log(`[Wallet] Deployer 钱包就绪: ${deployerWallet.address}`);
}

// 自动部署合约
async function deployContracts() {
    console.log("[Deploy] 开始部署 Groth16Verifier 与 ZKSecretVault 合约...");
    const verifierArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/Verifier.sol/Groth16Verifier.json')));
    const vaultArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/ZKSecretVault.sol/ZKSecretVault.json')));

    let nonce = await provider.getTransactionCount(deployerWallet.address, 'pending');

    // 1. 部署 Verifier
    const VerifierFactory = new ethers.ContractFactory(verifierArtifact.abi, verifierArtifact.bytecode.object, deployerWallet);
    verifierContract = await VerifierFactory.deploy({ nonce: nonce++ });
    await verifierContract.waitForDeployment();
    const verifierAddress = await verifierContract.getAddress();
    console.log(`[Deploy] Groth16Verifier 已部署至: ${verifierAddress}`);

    // 2. 部署 Vault
    const VaultFactory = new ethers.ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode.object, deployerWallet);
    vaultContract = await VaultFactory.deploy(verifierAddress, { nonce: nonce++ });
    await vaultContract.waitForDeployment();
    const vaultAddress = await vaultContract.getAddress();
    console.log(`[Deploy] ZKSecretVault 已部署至: ${vaultAddress}`);

    return { verifierAddress, vaultAddress };
}

// API: 获取系统状态与地址
app.get('/api/status', async (req, res) => {
    try {
        const vaultAddress = await vaultContract.getAddress();
        const verifierAddress = await verifierContract.getAddress();
        const balance = await provider.getBalance(vaultAddress);
        const aliceBalance = await provider.getBalance(aliceWallet.address);
        const bobBalance = await provider.getBalance(bobWallet.address);

        res.json({
            success: true,
            network: "Anvil Local EVM (ChainID: 31337)",
            vaultAddress,
            verifierAddress,
            vaultBalance: ethers.formatEther(balance),
            aliceAddress: aliceWallet.address,
            aliceBalance: ethers.formatEther(aliceBalance),
            bobAddress: bobWallet.address,
            bobBalance: ethers.formatEther(bobBalance)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: 执行链上存款 (模拟 Alice 存入 1 ETH)
app.post('/api/deposit', async (req, res) => {
    try {
        const { commitment } = req.body;
        if (!commitment) return res.status(400).json({ error: "Missing commitment" });

        const vaultWithAlice = vaultContract.connect(aliceWallet);
        const tx = await vaultWithAlice.deposit(BigInt(commitment), {
            value: ethers.parseEther("1.0")
        });
        const receipt = await tx.wait();

        res.json({
            success: true,
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: 执行链上提款 (带着前端在浏览器生成的 ZK Proof 提款给用户指定的 recipient)
app.post('/api/withdraw', async (req, res) => {
    try {
        const { a, b, c, nullifierHash, commitment, recipient } = req.body;
        if (!recipient) {
            return res.status(400).json({ error: "Missing recipient address" });
        }

        const vaultWithBob = vaultContract.connect(bobWallet);
        const tx = await vaultWithBob.withdraw(
            a,
            b,
            c,
            BigInt(nullifierHash),
            BigInt(commitment),
            recipient
        );
        const receipt = await tx.wait();

        res.json({
            success: true,
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            recipient: recipient
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: 一键重置清空金库重新部署
app.post('/api/reset', async (req, res) => {
    try {
        const result = await deployContracts();
        res.json({ success: true, ...result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 优雅退出清理
process.on('SIGINT', () => {
    if (anvilProcess) anvilProcess.kill();
    process.exit();
});

const PORT = 3000;
async function start() {
    poseidon = await buildPoseidon();
    await ensureAnvilRunning();
    await deployContracts();
    app.listen(PORT, () => {
        console.log(`\n======================================================`);
        console.log(`  ZK Secret Vault DApp 服务已启动: http://localhost:${PORT}`);
        console.log(`======================================================\n`);
    });
}

start().catch(console.error);
