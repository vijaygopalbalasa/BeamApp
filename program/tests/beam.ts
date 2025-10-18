import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Beam } from "../target/types/beam";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { assert } from "chai";
import { createAttestationProof, AttestationRole } from "./attestation-helper";

describe("beam", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Beam as Program<Beam>;

  let mint: PublicKey;
  let payerTokenAccount: PublicKey;
  let merchantTokenAccount: PublicKey;
  let escrowTokenAccount: PublicKey;
  let escrowPDA: PublicKey;
  let nonceRegistry: PublicKey;
  let payer: Keypair;

  const merchant = Keypair.generate();

  before(async () => {
    // Use provider wallet as payer
    payer = (provider.wallet as anchor.Wallet).payer;

    // Create USDC-like token mint
    mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6 // USDC decimals
    );

    // Create token accounts
    const payerATA = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      payer.publicKey
    );
    payerTokenAccount = payerATA.address;

    const merchantATA = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      merchant.publicKey
    );
    merchantTokenAccount = merchantATA.address;

    // Find escrow PDA
    [escrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), payer.publicKey.toBuffer()],
      program.programId
    );
    [nonceRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from("nonce"), payer.publicKey.toBuffer()],
      program.programId
    );
    // Create escrow token account (regular keypair with PDA as authority is not possible)
    // Use a keypair-owned account instead
    const escrowTokenKeypair = Keypair.generate();
    escrowTokenAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      escrowPDA,
      escrowTokenKeypair
    );

    // Mint 1000 USDC to payer
    await mintTo(
      provider.connection,
      payer,
      mint,
      payerTokenAccount,
      payer,
      1000_000000
    );
  });

  it("Initialize escrow with initial funds", async () => {
    const initialAmount = 500_000000; // 500 USDC

    await program.methods
      .initializeEscrow(new anchor.BN(initialAmount))
      .accounts({
        escrowAccount: escrowPDA,
        owner: payer.publicKey,
        ownerTokenAccount: payerTokenAccount,
        escrowTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    // Verify escrow account
    const escrowAccount = await program.account.offlineEscrowAccount.fetch(escrowPDA);
    assert.equal(escrowAccount.owner.toString(), payer.publicKey.toString());
    assert.equal(escrowAccount.escrowBalance.toNumber(), initialAmount);
    assert.equal(escrowAccount.lastNonce.toNumber(), 0);
    assert.equal(escrowAccount.reputationScore, 100);

    // Verify token transfer
    const escrowTokenAccountInfo = await getAccount(provider.connection, escrowTokenAccount);
    assert.equal(escrowTokenAccountInfo.amount.toString(), initialAmount.toString());
  });

  it("Fund escrow with additional tokens", async () => {
    const addAmount = 100_000000; // 100 USDC

    await program.methods
      .fundEscrow(new anchor.BN(addAmount))
      .accounts({
        escrowAccount: escrowPDA,
        owner: payer.publicKey,
        ownerTokenAccount: payerTokenAccount,
        escrowTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payer])
      .rpc();

    const escrowAccount = await program.account.offlineEscrowAccount.fetch(escrowPDA);
    assert.equal(escrowAccount.escrowBalance.toNumber(), 600_000000);
  });

  it("Initialize nonce registry", async () => {
    await program.methods
      .initializeNonceRegistry()
      .accountsPartial({
        payer: payer.publicKey,
        nonceRegistry,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    const registryAccount = await program.account.nonceRegistry.fetch(nonceRegistry);
    assert.equal(registryAccount.lastNonce.toNumber(), 0);
  });

  it("Settle offline payment with attestation", async () => {
    const paymentAmount = 10_000000; // 10 USDC
    const nonce = 1;
    const bundleId = `bundle-${nonce}`;

    const payerProof = await createAttestationProof(
      AttestationRole.Payer,
      bundleId,
      payer.publicKey,
      merchant.publicKey,
      paymentAmount,
      nonce
    );

    const evidence = {
      payerProof,
      merchantProof: null,
    };

    await program.methods
      .settleOfflinePayment(
        new anchor.BN(paymentAmount),
        new anchor.BN(nonce),
        bundleId,
        evidence
      )
      .accountsPartial({
        owner: payer.publicKey,
        payer: payer.publicKey,
        merchant: merchant.publicKey,
        escrowTokenAccount,
        merchantTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    // Verify escrow balance decreased
    const escrowAccount = await program.account.offlineEscrowAccount.fetch(escrowPDA);
    assert.equal(escrowAccount.escrowBalance.toNumber(), 590_000000);
    assert.equal(escrowAccount.lastNonce.toNumber(), 1);
    assert.equal(escrowAccount.totalSpent.toNumber(), 10_000000);

    // Verify merchant received tokens
    const merchantTokenAccountInfo = await getAccount(provider.connection, merchantTokenAccount);
    assert.equal(merchantTokenAccountInfo.amount.toString(), paymentAmount.toString());

    const registryAccount = await program.account.nonceRegistry.fetch(nonceRegistry);
    assert.equal(registryAccount.lastNonce.toNumber(), nonce);
    assert.equal(registryAccount.recentBundleHashes.length, 1);
  });

  it("Reject replay attack (duplicate bundle)", async () => {
    try {
      const replayBundleId = 'bundle-1';
      const payerProof = await createAttestationProof(
        AttestationRole.Payer,
        replayBundleId,
        payer.publicKey,
        merchant.publicKey,
        10_000000,
        1
      );

      const evidence = {
        payerProof,
        merchantProof: null,
      };

      await program.methods
        .settleOfflinePayment(
          new anchor.BN(10_000000),
          new anchor.BN(1),
          replayBundleId,
          evidence
        )
        .accountsPartial({
          owner: payer.publicKey,
          payer: payer.publicKey,
          merchant: merchant.publicKey,
          escrowTokenAccount,
          merchantTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      assert.fail("Should have failed with DuplicateBundle");
    } catch (err) {
      assert.include(err.toString(), "DuplicateBundle");
    }
  });

  it("Withdraw escrow funds", async () => {
    const withdrawAmount = 100_000000; // 100 USDC

    const balanceBefore = (await getAccount(provider.connection, payerTokenAccount)).amount;
    const escrowBefore = await program.account.offlineEscrowAccount.fetch(escrowPDA);

    await program.methods
      .withdrawEscrow(new anchor.BN(withdrawAmount))
      .accounts({
        escrowAccount: escrowPDA,
        owner: payer.publicKey,
        ownerTokenAccount: payerTokenAccount,
        escrowTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payer])
      .rpc();

    const escrowAccount = await program.account.offlineEscrowAccount.fetch(escrowPDA);
    // Since settlement tests failed, balance should be 600M - 100M = 500M
    assert.equal(escrowAccount.escrowBalance.toNumber(), escrowBefore.escrowBalance.toNumber() - withdrawAmount);

    const balanceAfter = (await getAccount(provider.connection, payerTokenAccount)).amount;
    assert.equal(Number(balanceAfter - balanceBefore), withdrawAmount);
  });

  it('Enforces duplicate bundle prevention', async () => {
    const paymentAmount = 5_000000;
    const nonce = 2;
    const bundleId = `bundle-${nonce}`;

    const payerProof = await createAttestationProof(
      AttestationRole.Payer,
      bundleId,
      payer.publicKey,
      merchant.publicKey,
      paymentAmount,
      nonce
    );

    const evidence = {
      payerProof,
      merchantProof: null,
    };

    await program.methods
      .settleOfflinePayment(
        new anchor.BN(paymentAmount),
        new anchor.BN(nonce),
        bundleId,
        evidence
      )
      .accountsPartial({
        owner: payer.publicKey,
        payer: payer.publicKey,
        merchant: merchant.publicKey,
        escrowTokenAccount,
        merchantTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    try {
      await program.methods
        .settleOfflinePayment(
          new anchor.BN(paymentAmount),
          new anchor.BN(nonce + 1),
          bundleId,
          evidence
        )
        .accountsPartial({
          owner: payer.publicKey,
          payer: payer.publicKey,
          merchant: merchant.publicKey,
          escrowTokenAccount,
          merchantTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
      assert.fail('Should have failed with DuplicateBundle');
    } catch (err) {
      assert.include(err.toString(), 'DuplicateBundle');
    }
  });

  it('Enforces bundle size limit', async () => {
    const longBundleId = 'bundle-' + 'x'.repeat(128);
    const payerProof = await createAttestationProof(
      AttestationRole.Payer,
      longBundleId,
      payer.publicKey,
      merchant.publicKey,
      1_000000,
      7777
    );

    const evidence = {
      payerProof,
      merchantProof: null,
    };

    try {
      await program.methods
        .settleOfflinePayment(
          new anchor.BN(1_000000),
          new anchor.BN(7777),
          longBundleId,
          evidence
        )
        .accountsPartial({
          owner: payer.publicKey,
          payer: payer.publicKey,
          merchant: merchant.publicKey,
          escrowTokenAccount,
          merchantTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
      assert.fail('Should have failed with InvalidBundleId');
    } catch (err) {
      assert.include(err.toString(), 'InvalidBundleId');
    }
  });
});
