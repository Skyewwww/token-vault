import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenVault } from "../target/types/token_vault";
import {
  createMint,
  createAssociatedTokenAccount,
  getAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { strict as assert } from "assert";

describe("token-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenVault as Program<TokenVault>;

  let mint: anchor.web3.PublicKey;

  let vaultConfigPda: anchor.web3.PublicKey;
  let vaultConfigBump: number;

  let vaultAuthorityPda: anchor.web3.PublicKey;
  let vaultAuthorityBump: number;

  let userPositionPda: anchor.web3.PublicKey;
  let userPositionBump: number;

  let userTokenAccount: anchor.web3.PublicKey;

  const vaultTokenAccount = anchor.web3.Keypair.generate();

  const attacker = anchor.web3.Keypair.generate();

  before(async () => {
    const wallet = provider.wallet as anchor.Wallet;

    const attackerSig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );

    await provider.connection.confirmTransaction(attackerSig);

    // 在本地创建测试 SPL Token mint
    mint = await createMint(
      provider.connection,
      wallet.payer,
      provider.wallet.publicKey,
      null,
      6
    );

    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      provider.wallet.publicKey
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      userTokenAccount,
      wallet.payer,
      1_000_000_000
    );

    [vaultConfigPda, vaultConfigBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault_config"), mint.toBuffer()],
        program.programId
      );

    [vaultAuthorityPda, vaultAuthorityBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault_authority"), mint.toBuffer()],
        program.programId
      );
    
    [userPositionPda, userPositionBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_position"),
          provider.wallet.publicKey.toBuffer(),
          mint.toBuffer()
        ],
        program.programId
      );

    console.log("program id:", program.programId.toBase58());
    console.log("mint:", mint.toBase58());
    console.log("vault config PDA:", vaultConfigPda.toBase58());
    console.log("vault config bump:", vaultConfigBump);
    console.log("vault authority PDA:", vaultAuthorityPda.toBase58());
    console.log("vault authority bump:", vaultAuthorityBump);
    console.log("vault token account:", vaultTokenAccount.publicKey.toBase58());
    console.log("user position PDA:", userPositionPda.toBase58());
    console.log("user position bump:", userPositionBump);
    console.log("token program:", TOKEN_PROGRAM_ID.toBase58());
  });

  it("prepares test mint, PDAs, and user token account", async () => {
    const userAccount = await getAccount(
      provider.connection,
      userTokenAccount
    );

    console.log("setup completed");
    console.log("user token account:", userTokenAccount.toBase58());
    console.log("user token account mint:", userAccount.mint.toBase58());
    console.log("user token account owner:", userAccount.owner.toBase58());
    console.log("user token account amount:", userAccount.amount.toString());
  });

  it("initializes vault", async () => {
    await program.methods
      .initializeVault()
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        mint,
        admin: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([vaultTokenAccount])
      .rpc();

    console.log("initialize vault transaction success");
    
    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);

    console.log("config admin:", vaultConfig.admin.toBase58());
    console.log("config mint:", vaultConfig.mint.toBase58());
    console.log("config vault token account:", vaultConfig.vaultTokenAccount.toBase58());
    console.log("config vault authority bump:", vaultConfig.vaultAuthorityBump);
    console.log("config bump:", vaultConfig.configBump);
    console.log("config paused:", vaultConfig.paused);

    assert.equal(
      vaultConfig.admin.toBase58(),
      provider.wallet.publicKey.toBase58()
    );

    assert.equal(
      vaultConfig.mint.toBase58(),
      mint.toBase58()
    );

    assert.equal(
      vaultConfig.vaultTokenAccount.toBase58(),
      vaultTokenAccount.publicKey.toBase58()
    );

    assert.equal(vaultConfig.vaultAuthorityBump, vaultAuthorityBump);
    assert.equal(vaultConfig.configBump, vaultConfigBump);
    assert.equal(vaultConfig.paused, false);

    const tokenAccount = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    console.log("token account mint:", tokenAccount.mint.toBase58());
    console.log("token account owner:", tokenAccount.owner.toBase58());
    console.log("token account amount:", tokenAccount.amount.toString());

    assert.equal(tokenAccount.mint.toBase58(), mint.toBase58());
    assert.equal(
      tokenAccount.owner.toBase58(),
      vaultAuthorityPda.toBase58()
    );
    assert.equal(tokenAccount.amount.toString(), "0");
  });

  it("initializes user position", async () => {
    await program.methods
      .initializePosition()
      .accounts({
        vaultConfig: vaultConfigPda,
        userPosition: userPositionPda,
        mint,
        user: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    const userPosition = await program.account.userPosition.fetch(userPositionPda);

    console.log("position user:", userPosition.user.toBase58());
    console.log("position mint:", userPosition.mint.toBase58());
    console.log("position deposited amount:", userPosition.depositedAmount.toString());
    console.log("position bump:", userPosition.bump);

    assert.equal(
      userPosition.user.toBase58(),
      provider.wallet.publicKey.toBase58()
    );
    assert.equal(userPosition.mint.toBase58(), mint.toBase58());
    assert.equal(userPosition.depositedAmount.toString(), "0");
    assert.equal(userPosition.bump, userPositionBump);
  });

  it("deposits tokens into vault", async () => {
    const depositAmount = new anchor.BN(100_000_000);

    await program.methods
      .deposit(depositAmount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        mint,
        userPosition: userPositionPda,
        userTokenAccount,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        user: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const userAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    console.log("user amount after deposit:", userAccountAfter.amount.toString());
    console.log("vault amount after deposit:", vaultAccountAfter.amount.toString());

    assert.equal(userAccountAfter.amount.toString(), "900000000");
    assert.equal(vaultAccountAfter.amount.toString(), "100000000");

    const userPosition = await program.account.userPosition.fetch(userPositionPda);

    console.log(
      "position deposited amount after deposit:",
      userPosition.depositedAmount.toString()
    );

    assert.equal(userPosition.depositedAmount.toString(), "100000000");
  });

  it("pause vault", async () => {
    await program.methods
      .pauseVault()
      .accounts({
        vaultConfig: vaultConfigPda,
        admin: provider.wallet.publicKey
      })
      .rpc();
    
    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);

    console.log("paused after pause:", vaultConfig.paused);

    assert.equal(vaultConfig.paused, true);
    assert.equal(vaultConfig.admin.toBase58(), provider.wallet.publicKey.toBase58());
    assert.equal(vaultConfig.mint.toBase58(), mint.toBase58());
    assert.equal(
      vaultConfig.vaultTokenAccount.toBase58(),
      vaultTokenAccount.publicKey.toBase58()
    );
  });

  it("fails to deposit while vault is paused", async () => {
    let didFail = false;

    try {
        await program.methods
        .deposit(new anchor.BN(100_000_000))
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultAuthority: vaultAuthorityPda,
          mint,
          userTokenAccount,
          vaultTokenAccount: vaultTokenAccount.publicKey,
          user: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (err) {
      didFail = true;
      console.log("expected paused deposit error:", String(err));
    }

    assert.equal(didFail, true);

    const userAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    console.log("user amount after failed deposit:", userAccountAfter.amount.toString());
    console.log("vault amount after failed deposit:", vaultAccountAfter.amount.toString());

    assert.equal(userAccountAfter.amount.toString(), "900000000");
    assert.equal(vaultAccountAfter.amount.toString(), "100000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    assert.equal(vaultConfig.paused, true);
  });

  it("unpauses vault", async () => {
    await program.methods
      .unpauseVault()
      .accounts({
        vaultConfig: vaultConfigPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);

    console.log("paused after unpause:", vaultConfig.paused);

    assert.equal(vaultConfig.paused, false);
    assert.equal(vaultConfig.admin.toBase58(), provider.wallet.publicKey.toBase58());
    assert.equal(vaultConfig.mint.toBase58(), mint.toBase58());
    assert.equal(
      vaultConfig.vaultTokenAccount.toBase58(),
      vaultTokenAccount.publicKey.toBase58()
    );
  });

  it("deposits again after unpause", async () => {
    const depositAmount = new anchor.BN(10_000_000);

    await program.methods
      .deposit(depositAmount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        mint,
        userTokenAccount,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        user: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const userAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    console.log(
      "user amount after unpause deposit:",
      userAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after unpause deposit:",
      vaultAccountAfter.amount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "890000000");
    assert.equal(vaultAccountAfter.amount.toString(), "110000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    assert.equal(vaultConfig.paused, false);
  });

  it("admin withdraws tokens from vault", async () => {
    const withdrawAmount = new anchor.BN(10_000_000);

    await program.methods
      .adminWithdraw(withdrawAmount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        mint,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        userTokenAccount,
        admin: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const userAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    console.log(
      "user amount after admin withdraw:",
      userAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after admin withdraw:",
      vaultAccountAfter.amount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "900000000");
    assert.equal(vaultAccountAfter.amount.toString(), "100000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    assert.equal(vaultConfig.paused, false);
    assert.equal(
      vaultConfig.admin.toBase58(),
      provider.wallet.publicKey.toBase58()
    );
    assert.equal(vaultConfig.mint.toBase58(), mint.toBase58());
    assert.equal(
      vaultConfig.vaultTokenAccount.toBase58(),
      vaultTokenAccount.publicKey.toBase58()
    );
  });

  it("fails to admin withdraw while vault is paused", async () => {
    await program.methods
      .pauseVault()
      .accounts({
        vaultConfig: vaultConfigPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();
    
    const pausedConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    console.log("paused before failed withdraw:", pausedConfig.paused);
    assert.equal(pausedConfig.paused, true);

    let didFail = false;

    try { 
      await program.methods
      .adminWithdraw(new anchor.BN(10_000_000))
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        mint,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        userTokenAccount,
        admin: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    } catch (err) {
      didFail = true;
      console.log("expected paused withdraw error:", String(err));
    }

    assert.equal(didFail, true);

    const userAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    console.log(
      "user amount after admin withdraw:",
      userAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after admin withdraw:",
      vaultAccountAfter.amount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "900000000");
    assert.equal(vaultAccountAfter.amount.toString(), "100000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    assert.equal(vaultConfig.paused, true);
  });

  it("fails when non-admin tries to admin withdraw", async () => {
    await program.methods
      .unpauseVault()
      .accounts({
        vaultConfig: vaultConfigPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();
    
    const unpausedConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    console.log("paused before non-admin withdraw:", unpausedConfig.paused);
    assert.equal(unpausedConfig.paused, false);

    let didFail = false;

    try { 
      await program.methods
      .adminWithdraw(new anchor.BN(10_000_000))
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        mint,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        userTokenAccount,
        admin: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([attacker])
      .rpc();
    } catch (err) {
      didFail = true;
      console.log("expected non-admin withdraw error:", String(err));
    }

    assert.equal(didFail, true);

    const userAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    console.log(
      "user amount after non-admin failed withdraw:",
      userAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after non-admin failed withdraw:",
      vaultAccountAfter.amount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "900000000");
    assert.equal(vaultAccountAfter.amount.toString(), "100000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    assert.equal(vaultConfig.paused, false);
    assert.equal(
      vaultConfig.admin.toBase58(),
      provider.wallet.publicKey.toBase58()
    );
    assert.equal(vaultConfig.mint.toBase58(), mint.toBase58());
    assert.equal(
      vaultConfig.vaultTokenAccount.toBase58(),
      vaultTokenAccount.publicKey.toBase58()
    );
  });

  it("user withdraws tokens from vault", async () => {
    const withdrawAmount = new anchor.BN(10_000_000);

    await program.methods
      .userWithdraw(withdrawAmount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        mint,
        userPosition: userPositionPda,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        userTokenAccount,
        user: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const userAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    const userPosition = await program.account.userPosition.fetch(userPositionPda);

    console.log(
      "user amount after user withdraw:",
      userAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after user withdraw:",
      vaultAccountAfter.amount.toString()
    );
    console.log(
      "position deposited amount after user withdraw:",
      userPosition.depositedAmount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "910000000");
    assert.equal(vaultAccountAfter.amount.toString(), "90000000");
    assert.equal(userPosition.depositedAmount.toString(), "100000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    assert.equal(vaultConfig.paused, false);
  });

  it("fails when user withdraws more than position balance", async () => {
    let didFail = false;

    try {
      await program.methods
        .userWithdraw(new anchor.BN(200_000_000))
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultAuthority: vaultAuthorityPda,
          mint,
          userPosition: userPositionPda,
          vaultTokenAccount: vaultTokenAccount.publicKey,
          userTokenAccount,
          user: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (err) {
      didFail = true;
      console.log("expected over-withdraw error:", String(err));
    }

    assert.equal(didFail, true);

    const userAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    const userPosition = await program.account.userPosition.fetch(userPositionPda);

    console.log(
      "user amount after failed over-withdraw:",
      userAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after failed over-withdraw:",
      vaultAccountAfter.amount.toString()
    );
    console.log(
      "position deposited amount after failed over-withdraw:",
      userPosition.depositedAmount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "910000000");
    assert.equal(vaultAccountAfter.amount.toString(), "90000000");
    assert.equal(userPosition.depositedAmount.toString(), "100000000");
  });

  it("fails to user withdraw while vault is paused", async () => {
    await program.methods
      .pauseVault()
      .accounts({
        vaultConfig: vaultConfigPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();

    const pausedConfig = await program.account.vaultConfig.fetch(vaultConfigPda);

    console.log("paused before failed user withdraw:", pausedConfig.paused);

    assert.equal(pausedConfig.paused, true);

    let didFail = false;

    try {
      await program.methods
        .userWithdraw(new anchor.BN(10_000_000))
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultAuthority: vaultAuthorityPda,
          mint,
          userPosition: userPositionPda,
          vaultTokenAccount: vaultTokenAccount.publicKey,
          userTokenAccount,
          user: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (err) {
      didFail = true;
      console.log("expected paused user withdraw error:", String(err));
    }

    assert.equal(didFail, true);

    const userAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    const userPosition = await program.account.userPosition.fetch(userPositionPda);

    console.log(
      "user amount after failed paused user withdraw:",
      userAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after failed paused user withdraw:",
      vaultAccountAfter.amount.toString()
    );
    console.log(
      "position deposited amount after failed paused user withdraw:",
      userPosition.depositedAmount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "910000000");
    assert.equal(vaultAccountAfter.amount.toString(), "90000000");
    assert.equal(userPosition.depositedAmount.toString(), "100000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    assert.equal(vaultConfig.paused, true);
  });
});