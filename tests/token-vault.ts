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
  const wallet = provider.wallet as anchor.Wallet;

  const attacker = anchor.web3.Keypair.generate();

  const secondUser = anchor.web3.Keypair.generate();

  let secondUserTokenAccount: anchor.web3.PublicKey;
  let secondUserPositionPda: anchor.web3.PublicKey;
  let secondUserPositionBump: number;

  let mint: anchor.web3.PublicKey;

  let vaultConfigPda: anchor.web3.PublicKey;
  let vaultConfigBump: number;

  let vaultAuthorityPda: anchor.web3.PublicKey;
  let vaultAuthorityBump: number;

  let userPositionPda: anchor.web3.PublicKey;
  let userPositionBump: number;

  let userTokenAccount: anchor.web3.PublicKey;
  let attackerTokenAccount: anchor.web3.PublicKey;

  const vaultTokenAccount = anchor.web3.Keypair.generate();

  before(async () => {
    // create test in loaclhost: SPL Token mint
    mint = await createMint(
      provider.connection,
      wallet.payer,
      provider.wallet.publicKey,
      null,
      6
    );
    
    // airdrop second user SOL
    const secondUserSig = await provider.connection.requestAirdrop(
      secondUser.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );

    await provider.connection.confirmTransaction(secondUserSig);

    secondUserTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      secondUser.publicKey
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      secondUserTokenAccount,
      wallet.payer,
      500_000_000
    );

    // airdrop attacker SOL
    const attackerSig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );

    await provider.connection.confirmTransaction(attackerSig);

    attackerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      attacker.publicKey
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

    [secondUserPositionPda, secondUserPositionBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_position"),
          secondUser.publicKey.toBuffer(),
          mint.toBuffer(),
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
    console.log("second user:", secondUser.publicKey.toBase58());
    console.log("second user token account:", secondUserTokenAccount.toBase58());
    console.log("second user position PDA:", secondUserPositionPda.toBase58());
    console.log("second user position bump:", secondUserPositionBump);
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

  it.skip("admin withdraws tokens from vault", async () => {
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

  it.skip("fails to admin withdraw while vault is paused", async () => {
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

  it.skip("fails when non-admin tries to admin withdraw", async () => {
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

    assert.equal(userAccountAfter.amount.toString(), "900000000");
    assert.equal(vaultAccountAfter.amount.toString(), "100000000");
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

    assert.equal(userAccountAfter.amount.toString(), "900000000");
    assert.equal(vaultAccountAfter.amount.toString(), "100000000");
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

    assert.equal(userAccountAfter.amount.toString(), "900000000");
    assert.equal(vaultAccountAfter.amount.toString(), "100000000");
    assert.equal(userPosition.depositedAmount.toString(), "100000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    assert.equal(vaultConfig.paused, true);
  });

  it("fails when attacker tries to withdraw using another user's position", async () => {
    await program.methods
      .unpauseVault()
      .accounts({
        vaultConfig: vaultConfigPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();

    const unpausedConfig = await program.account.vaultConfig.fetch(vaultConfigPda);

    console.log("paused before attacker user withdraw:", unpausedConfig.paused);

    assert.equal(unpausedConfig.paused, false);

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
          userTokenAccount: attackerTokenAccount,
          user: attacker.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc();
    } catch (err) {
      didFail = true;
      console.log("expected attacker user withdraw error:", String(err));
    }

    assert.equal(didFail, true);

    const realUserAccountAfter = await getAccount(
      provider.connection,
      userTokenAccount
    );

    const attackerAccountAfter = await getAccount(
      provider.connection,
      attackerTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    const userPosition = await program.account.userPosition.fetch(userPositionPda);

    console.log(
      "real user amount after attacker failed withdraw:",
      realUserAccountAfter.amount.toString()
    );
    console.log(
      "attacker amount after failed withdraw:",
      attackerAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after attacker failed withdraw:",
      vaultAccountAfter.amount.toString()
    );
    console.log(
      "position deposited amount after attacker failed withdraw:",
      userPosition.depositedAmount.toString()
    );

    assert.equal(realUserAccountAfter.amount.toString(), "900000000");
    assert.equal(attackerAccountAfter.amount.toString(), "0");
    assert.equal(vaultAccountAfter.amount.toString(), "100000000");
    assert.equal(userPosition.depositedAmount.toString(), "100000000"); 
  });

  it("admin withdraws tokens from vault and updates user position", async () => {
    const withdrawAmount = new anchor.BN(10_000_000);

    await program.methods
      .adminWithdraw(withdrawAmount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        mint,
        userPosition: userPositionPda,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        userTokenAccount,
        recipient: provider.wallet.publicKey,
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

    const userPosition = await program.account.userPosition.fetch(userPositionPda);

    console.log(
      "user amount after admin withdraw:",
      userAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after admin withdraw:",
      vaultAccountAfter.amount.toString()
    );
    console.log(
      "position deposited amount after admin withdraw:",
      userPosition.depositedAmount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "910000000");
    assert.equal(vaultAccountAfter.amount.toString(), "90000000");
    assert.equal(userPosition.depositedAmount.toString(), "90000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    assert.equal(vaultConfig.paused, false);
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

    console.log("paused before failed admin withdraw:", pausedConfig.paused);

    assert.equal(pausedConfig.paused, true);

    let didFail = false;

    try {
      await program.methods
        .adminWithdraw(new anchor.BN(10_000_000))
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultAuthority: vaultAuthorityPda,
          mint,
          userPosition: userPositionPda,
          vaultTokenAccount: vaultTokenAccount.publicKey,
          userTokenAccount,
          recipient: provider.wallet.publicKey,
          admin: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (err) {
      didFail = true;
      console.log("expected paused admin withdraw error:", String(err));
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
      "user amount after failed paused admin withdraw:",
      userAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after failed paused admin withdraw:",
      vaultAccountAfter.amount.toString()
    );
    console.log(
      "position deposited amount after failed paused admin withdraw:",
      userPosition.depositedAmount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "910000000");
    assert.equal(vaultAccountAfter.amount.toString(), "90000000");
    assert.equal(userPosition.depositedAmount.toString(), "90000000");

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

    console.log("paused before non-admin admin withdraw:", unpausedConfig.paused);

    assert.equal(unpausedConfig.paused, false);

    let didFail = false;

    try {
      await program.methods
        .adminWithdraw(new anchor.BN(10_000_000))
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultAuthority: vaultAuthorityPda,
          mint,
          userPosition: userPositionPda,
          vaultTokenAccount: vaultTokenAccount.publicKey,
          userTokenAccount,
          recipient: provider.wallet.publicKey,
          admin: attacker.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc();
    } catch (err) {
      didFail = true;
      console.log("expected non-admin admin withdraw error:", String(err));
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
      "user amount after non-admin failed admin withdraw:",
      userAccountAfter.amount.toString()
    );

    console.log(
      "vault amount after non-admin failed admin withdraw:",
      vaultAccountAfter.amount.toString()
    );

    console.log(
      "position deposited amount after non-admin failed admin withdraw:",
      userPosition.depositedAmount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "910000000");
    assert.equal(vaultAccountAfter.amount.toString(), "90000000");
    assert.equal(userPosition.depositedAmount.toString(), "90000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    
    assert.equal(vaultConfig.paused, false);
  });

  it("fails when admin withdraws more than recipient position balance", async () => {
    let didFail = false;

    try {
      await program.methods
        .adminWithdraw(new anchor.BN(200_000_000))
        .accounts({
          vaultConfig: vaultConfigPda,
          vaultAuthority: vaultAuthorityPda,
          mint,
          userPosition: userPositionPda,
          vaultTokenAccount: vaultTokenAccount.publicKey,
          userTokenAccount,
          recipient: provider.wallet.publicKey,
          admin: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (err) {
      didFail = true;
      console.log("expected over-admin-withdraw error:", String(err));
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
      "user amount after failed over-admin-withdraw:",
      userAccountAfter.amount.toString()
    );

    console.log(
      "vault amount after failed over-admin-withdraw:",
      vaultAccountAfter.amount.toString()
    );

    console.log(
      "position deposited amount after failed over-admin-withdraw:",
      userPosition.depositedAmount.toString()
    );

    assert.equal(userAccountAfter.amount.toString(), "910000000");
    assert.equal(vaultAccountAfter.amount.toString(), "90000000");
    assert.equal(userPosition.depositedAmount.toString(), "90000000");

    const vaultConfig = await program.account.vaultConfig.fetch(vaultConfigPda);
    assert.equal(vaultConfig.paused, false);
  });

  it("initializes second user position", async () => {
    await program.methods
      .initializePosition()
      .accounts({
        vaultConfig: vaultConfigPda,
        userPosition: secondUserPositionPda,
        mint,
        user: secondUser.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([secondUser])
      .rpc();

    const secondUserPosition = await program.account.userPosition.fetch(
      secondUserPositionPda
    );

    console.log("second position user:", secondUserPosition.user.toBase58());
    console.log("second position mint:", secondUserPosition.mint.toBase58());
    console.log(
      "second position deposited amount:",
      secondUserPosition.depositedAmount.toString()
    );
    console.log("second position bump:", secondUserPosition.bump);

    assert.equal(
      secondUserPosition.user.toBase58(),
      secondUser.publicKey.toBase58()
    );
    assert.equal(secondUserPosition.mint.toBase58(), mint.toBase58());
    assert.equal(secondUserPosition.depositedAmount.toString(), "0");
    assert.equal(secondUserPosition.bump, secondUserPositionBump);
  });

  it("second user deposits independently", async () => {
    const depositAmount = new anchor.BN(50_000_000);

    await program.methods
      .deposit(depositAmount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        mint,
        userPosition: secondUserPositionPda,
        userTokenAccount: secondUserTokenAccount,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        user: secondUser.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([secondUser])
      .rpc();

    const secondUserAccountAfter = await getAccount(
      provider.connection,
      secondUserTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    const secondUserPosition = await program.account.userPosition.fetch(
      secondUserPositionPda
    );

    const mainUserPosition = await program.account.userPosition.fetch(
      userPositionPda
    );

    console.log(
      "second user amount after deposit:",
      secondUserAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after second user deposit:",
      vaultAccountAfter.amount.toString()
    );
    console.log(
      "second position deposited amount after deposit:",
      secondUserPosition.depositedAmount.toString()
    );
    console.log(
      "main position deposited amount after second user deposit:",
      mainUserPosition.depositedAmount.toString()
    );

    assert.equal(secondUserAccountAfter.amount.toString(), "450000000");
    assert.equal(secondUserPosition.depositedAmount.toString(), "50000000");
    assert.equal(mainUserPosition.depositedAmount.toString(), "90000000");
    assert.equal(vaultAccountAfter.amount.toString(), "140000000");
  });

  it("second user deposits independently", async () => {
    const withdrawAmount = new anchor.BN(20_000_000);

    await program.methods
      .userWithdraw(withdrawAmount)
      .accounts({
        vaultConfig: vaultConfigPda,
        vaultAuthority: vaultAuthorityPda,
        mint,
        userPosition: secondUserPositionPda,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        userTokenAccount: secondUserTokenAccount,
        user: secondUser.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([secondUser])
      .rpc();
    
    const secondUserAccountAfter = await getAccount(
      provider.connection,
      secondUserTokenAccount
    );

    const vaultAccountAfter = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );

    const secondUserPosition = await program.account.userPosition.fetch(
      secondUserPositionPda
    );

    const mainUserPosition = await program.account.userPosition.fetch(
      userPositionPda
    );

    console.log(
      "second user amount after withdraw:",
      secondUserAccountAfter.amount.toString()
    );
    console.log(
      "vault amount after second user withdraw:",
      vaultAccountAfter.amount.toString()
    );
    console.log(
      "second position deposited amount after withdraw:",
      secondUserPosition.depositedAmount.toString()
    );
    console.log(
      "main position deposited amount after second user withdraw:",
      mainUserPosition.depositedAmount.toString()
    );

    assert.equal(secondUserAccountAfter.amount.toString(), "470000000");
    assert.equal(vaultAccountAfter.amount.toString(), "120000000");
    assert.equal(secondUserPosition.depositedAmount.toString(), "30000000");
    assert.equal(mainUserPosition.depositedAmount.toString(), "90000000");
  });
});