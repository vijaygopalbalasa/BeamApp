import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Beam } from "../target/types/beam";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createInitializeAccountInstruction,
  getMinimumBalanceForRentExemptAccount,
  ACCOUNT_SIZE,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("beam-simple", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Beam as Program<Beam>;

  let mint: PublicKey;
  let payerTokenAccount: PublicKey;
  let escrowTokenAccount: Keypair;
  let merchantTokenAccount: Keypair;
  let escrowPDA: PublicKey;
  let payer: Keypair;

  const merchant = Keypair.generate();

  before(async () => {
    payer = (provider.wallet as anchor.Wallet).payer;

    // Create USDC mint
    mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    // Create payer token account (simple keypair-owned)
    const payerTokenKeypair = Keypair.generate();
    const lamports = await getMinimumBalanceForRentExemptAccount(
      provider.connection
    );
    const createPayerAccountIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: payerTokenKeypair.publicKey,
      lamports,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    });
    const initPayerAccountIx = createInitializeAccountInstruction(
      payerTokenKeypair.publicKey,
      mint,
      payer.publicKey
    );
    const tx1 = new Transaction().add(createPayerAccountIx, initPayerAccountIx);
    await provider.sendAndConfirm(tx1, [payerTokenKeypair]);
    payerTokenAccount = payerTokenKeypair.publicKey;

    // Mint tokens to payer
    await mintTo(
      provider.connection,
      payer,
      mint,
      payerTokenAccount,
      payer,
      1000_000000
    );

    // Find escrow PDA
    [escrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), payer.publicKey.toBuffer()],
      program.programId
    );

    // Create escrow token account (owned by escrowPDA)
    escrowTokenAccount = Keypair.generate();
    const createEscrowAccountIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: escrowTokenAccount.publicKey,
      lamports,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    });
    const initEscrowAccountIx = createInitializeAccountInstruction(
      escrowTokenAccount.publicKey,
      mint,
      escrowPDA // PDA as owner
    );
    const tx2 = new Transaction().add(
      createEscrowAccountIx,
      initEscrowAccountIx
    );
    await provider.sendAndConfirm(tx2, [escrowTokenAccount]);

    // Create merchant token account
    merchantTokenAccount = Keypair.generate();
    const createMerchantAccountIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: merchantTokenAccount.publicKey,
      lamports,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    });
    const initMerchantAccountIx = createInitializeAccountInstruction(
      merchantTokenAccount.publicKey,
      mint,
      merchant.publicKey
    );
    const tx3 = new Transaction().add(
      createMerchantAccountIx,
      initMerchantAccountIx
    );
    await provider.sendAndConfirm(tx3, [merchantTokenAccount]);
  });

  it("Initialize escrow with funds", async () => {
    await program.methods
      .initializeEscrow(new anchor.BN(500_000000))
      .accounts({
        escrowAccount: escrowPDA,
        owner: payer.publicKey,
        ownerTokenAccount: payerTokenAccount,
        escrowTokenAccount: escrowTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const escrow = await program.account.offlineEscrowAccount.fetch(escrowPDA);
    assert.equal(escrow.escrowBalance.toNumber(), 500_000000);
    assert.equal(escrow.lastNonce.toNumber(), 0);

    const escrowToken = await getAccount(
      provider.connection,
      escrowTokenAccount.publicKey
    );
    assert.equal(escrowToken.amount.toString(), "500000000");
  });

  it("Settle offline payment", async () => {
    await program.methods
      .settleOfflinePayment(new anchor.BN(10_000000), new anchor.BN(1))
      .accounts({
        escrowAccount: escrowPDA,
        owner: payer.publicKey,
        payer: payer.publicKey,
        merchant: merchant.publicKey,
        escrowTokenAccount: escrowTokenAccount.publicKey,
        merchantTokenAccount: merchantTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const escrow = await program.account.offlineEscrowAccount.fetch(escrowPDA);
    assert.equal(escrow.escrowBalance.toNumber(), 490_000000);
    assert.equal(escrow.lastNonce.toNumber(), 1);

    const merchantToken = await getAccount(
      provider.connection,
      merchantTokenAccount.publicKey
    );
    assert.equal(merchantToken.amount.toString(), "10000000");
  });

  it("Reject replay attack", async () => {
    try {
      await program.methods
        .settleOfflinePayment(new anchor.BN(5_000000), new anchor.BN(1))
        .accounts({
          escrowAccount: escrowPDA,
          owner: payer.publicKey,
          payer: payer.publicKey,
          merchant: merchant.publicKey,
          escrowTokenAccount: escrowTokenAccount.publicKey,
          merchantTokenAccount: merchantTokenAccount.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.include(err.toString(), "InvalidNonce");
    }
  });

  it("Withdraw escrow", async () => {
    await program.methods
      .withdrawEscrow(new anchor.BN(100_000000))
      .accounts({
        escrowAccount: escrowPDA,
        owner: payer.publicKey,
        ownerTokenAccount: payerTokenAccount,
        escrowTokenAccount: escrowTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const escrow = await program.account.offlineEscrowAccount.fetch(escrowPDA);
    assert.equal(escrow.escrowBalance.toNumber(), 390_000000);
  });
});
