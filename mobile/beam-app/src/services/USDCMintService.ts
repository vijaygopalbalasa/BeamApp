/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * USDC Minting Service
 * Handles automated USDC token minting for devnet testing
 *
 * This service:
 * 1. Creates a custom SPL token mint with 6 decimals (USDC-compatible)
 * 2. Stores mint authority keypair securely in AsyncStorage
 * 3. Automatically mints tokens to user wallets on request
 * 4. Creates associated token accounts if needed
 *
 * Note: This is for TESTING ONLY on devnet. In production, use real USDC.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../config';
import { wallet } from '../wallet/WalletManager';

interface MintResult {
  signature: string;
  amount: number;
  tokenAccount: string;
  mint: string;
}

export class USDCMintError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly shouldRetry?: boolean
  ) {
    super(message);
    this.name = 'USDCMintError';
  }
}

const MINT_AUTHORITY_STORAGE_KEY = '@beam:usdc_mint_authority';
const USDC_MINT_ADDRESS_KEY = '@beam:usdc_mint_address';
const USDC_DECIMALS = 6;

class USDCMintService {
  private connection: Connection;
  private mintAuthority: Keypair | null = null;
  private mintAddress: PublicKey | null = null;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.connection = new Connection(Config.solana.rpcUrl, 'confirmed');
  }

  /**
   * Initialize the mint authority and mint address
   * This loads or creates a keypair for mint authority
   */
  private async initialize(): Promise<void> {
    // If already initialized, return
    if (this.mintAuthority && this.mintAddress) {
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start initialization
    this.initializationPromise = this._doInitialize();
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async _doInitialize(): Promise<void> {
    try {
      // Try to load existing mint authority from storage
      const storedKeypair = await AsyncStorage.getItem(MINT_AUTHORITY_STORAGE_KEY);
      const storedMintAddress = await AsyncStorage.getItem(USDC_MINT_ADDRESS_KEY);

      if (storedKeypair && storedMintAddress) {
        // Load existing mint authority and mint
        const secretKey = JSON.parse(storedKeypair);
        this.mintAuthority = Keypair.fromSecretKey(new Uint8Array(secretKey));
        this.mintAddress = new PublicKey(storedMintAddress);

        if (__DEV__) {
          console.log('Loaded existing USDC mint:', this.mintAddress.toBase58());
          console.log('Mint authority:', this.mintAuthority.publicKey.toBase58());
        }
      } else {
        // Create new mint authority and mint
        await this.createNewMint();
      }
    } catch (err) {
      console.error('Failed to initialize USDC mint service:', err);
      throw new USDCMintError(
        'Failed to initialize USDC minting service',
        'INIT_FAILED',
        true
      );
    }
  }

  /**
   * Create a new SPL token mint with the app wallet as mint authority
   * This requires the app wallet to have SOL for rent
   */
  private async createNewMint(): Promise<void> {
    try {
      // Generate new keypair for mint authority
      this.mintAuthority = Keypair.generate();

      // Get the app wallet to pay for mint creation
      const appWallet = wallet.getPublicKey();
      if (!appWallet) {
        throw new USDCMintError(
          'App wallet not initialized',
          'WALLET_NOT_INITIALIZED',
          false
        );
      }

      // Get a signer for transactions
      const signer = await wallet.getSigner('Create USDC test mint');
      if (!signer) {
        throw new USDCMintError(
          'Cannot sign transactions - wallet locked',
          'WALLET_LOCKED',
          false
        );
      }

      if (__DEV__) {
        console.log('Creating new USDC test mint...');
        console.log('Mint authority:', this.mintAuthority.publicKey.toBase58());
      }

      // Check if wallet has enough SOL (need ~0.002 SOL for mint creation)
      const balance = await this.connection.getBalance(appWallet);
      if (balance < 0.002 * LAMPORTS_PER_SOL) {
        throw new USDCMintError(
          'Insufficient SOL balance to create USDC mint. Please fund your wallet with SOL first.',
          'INSUFFICIENT_SOL',
          false
        );
      }

      // Create the mint using createMint which handles everything
      this.mintAddress = await createMint(
        this.connection,
        {
          publicKey: appWallet,
          secretKey: new Uint8Array() // We'll sign separately
        } as any, // Temporary workaround for typing
        this.mintAuthority.publicKey, // mint authority
        null, // freeze authority (none)
        USDC_DECIMALS,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      // Store the mint authority keypair and mint address
      await AsyncStorage.setItem(
        MINT_AUTHORITY_STORAGE_KEY,
        JSON.stringify(Array.from(this.mintAuthority.secretKey))
      );
      await AsyncStorage.setItem(USDC_MINT_ADDRESS_KEY, this.mintAddress.toBase58());

      if (__DEV__) {
        console.log('Successfully created USDC test mint:', this.mintAddress.toBase58());
      }
    } catch (err) {
      console.error('Failed to create new mint:', err);
      throw new USDCMintError(
        `Failed to create USDC mint: ${err instanceof Error ? err.message : String(err)}`,
        'MINT_CREATION_FAILED',
        true
      );
    }
  }

  /**
   * Mint USDC tokens to a user's wallet
   * Creates associated token account if it doesn't exist
   *
   * @param recipientPublicKey - User's wallet address
   * @param amountUsdc - Amount in USDC (e.g., 100 for 100 USDC)
   */
  async mintUsdc(
    recipientPublicKey: PublicKey,
    amountUsdc: number = 100
  ): Promise<MintResult> {
    try {
      // Ensure mint service is initialized
      await this.initialize();

      if (!this.mintAuthority || !this.mintAddress) {
        throw new USDCMintError(
          'USDC mint service not initialized',
          'NOT_INITIALIZED',
          true
        );
      }

      if (__DEV__) {
        console.log(`Minting ${amountUsdc} USDC to ${recipientPublicKey.toBase58()}`);
      }

      // Get the app wallet to pay for transaction fees
      const appWallet = wallet.getPublicKey();
      if (!appWallet) {
        throw new USDCMintError(
          'App wallet not initialized',
          'WALLET_NOT_INITIALIZED',
          false
        );
      }

      // Get signer
      const signer = await wallet.getSigner(`Mint ${amountUsdc} USDC`);
      if (!signer) {
        throw new USDCMintError(
          'Cannot sign transactions - wallet locked',
          'WALLET_LOCKED',
          false
        );
      }

      // Calculate amount with decimals
      const amountWithDecimals = amountUsdc * Math.pow(10, USDC_DECIMALS);

      // Get associated token address
      const associatedTokenAddress = await getAssociatedTokenAddress(
        this.mintAddress,
        recipientPublicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Check if token account exists
      let accountExists = false;
      try {
        await getAccount(this.connection, associatedTokenAddress);
        accountExists = true;
      } catch (err) {
        // Account doesn't exist, we'll create it
        accountExists = false;
      }

      // Build transaction
      const transaction = new Transaction();

      // Add create account instruction if needed
      if (!accountExists) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            appWallet, // payer
            associatedTokenAddress,
            recipientPublicKey, // owner
            this.mintAddress, // mint
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        if (__DEV__) {
          console.log('Creating associated token account:', associatedTokenAddress.toBase58());
        }
      }

      // Add mint instruction
      const mintInstruction = await this.createMintToInstruction(
        this.mintAddress,
        associatedTokenAddress,
        this.mintAuthority.publicKey,
        amountWithDecimals
      );
      transaction.add(mintInstruction);

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = appWallet;

      // Sign with app wallet
      const messageToSign = transaction.serializeMessage();
      const appSignature = await signer.sign(messageToSign);
      transaction.addSignature(appWallet, Buffer.from(appSignature));

      // Sign with mint authority
      transaction.partialSign(this.mintAuthority);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        }
      );

      if (__DEV__) {
        console.log('Mint transaction sent:', signature);
      }

      // Confirm transaction with timeout
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new USDCMintError(
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
          'TX_FAILED',
          true
        );
      }

      if (__DEV__) {
        console.log('Mint transaction confirmed!');
      }

      return {
        signature,
        amount: amountUsdc,
        tokenAccount: associatedTokenAddress.toBase58(),
        mint: this.mintAddress.toBase58(),
      };
    } catch (err) {
      console.error('Failed to mint USDC:', err);

      if (err instanceof USDCMintError) {
        throw err;
      }

      // Wrap unknown errors
      const message = err instanceof Error ? err.message : String(err);
      throw new USDCMintError(
        `Failed to mint USDC: ${message}`,
        'MINT_FAILED',
        true
      );
    }
  }

  /**
   * Create a mint instruction manually since mintTo requires a Signer
   */
  private async createMintToInstruction(
    mint: PublicKey,
    destination: PublicKey,
    authority: PublicKey,
    amount: number
  ): Promise<any> {
    const keys = [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ];

    const data = Buffer.alloc(9);
    data.writeUInt8(7, 0); // MintTo instruction
    data.writeBigUInt64LE(BigInt(amount), 1);

    return {
      keys,
      programId: TOKEN_PROGRAM_ID,
      data,
    };
  }

  /**
   * Get the current mint address
   */
  async getMintAddress(): Promise<PublicKey | null> {
    await this.initialize();
    return this.mintAddress;
  }

  /**
   * Get token account address for a user
   */
  async getTokenAccountAddress(userPublicKey: PublicKey): Promise<string> {
    await this.initialize();

    if (!this.mintAddress) {
      throw new USDCMintError(
        'USDC mint not initialized',
        'NOT_INITIALIZED',
        true
      );
    }

    const tokenAccount = await getAssociatedTokenAddress(
      this.mintAddress,
      userPublicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    return tokenAccount.toBase58();
  }

  /**
   * Check if a user has a token account
   */
  async hasTokenAccount(userPublicKey: PublicKey): Promise<boolean> {
    try {
      await this.initialize();

      if (!this.mintAddress) {
        return false;
      }

      const tokenAccount = await getAssociatedTokenAddress(
        this.mintAddress,
        userPublicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const accountInfo = await this.connection.getAccountInfo(tokenAccount);
      return accountInfo !== null;
    } catch {
      return false;
    }
  }

  /**
   * Reset the mint service (for testing)
   */
  async reset(): Promise<void> {
    await AsyncStorage.removeItem(MINT_AUTHORITY_STORAGE_KEY);
    await AsyncStorage.removeItem(USDC_MINT_ADDRESS_KEY);
    this.mintAuthority = null;
    this.mintAddress = null;
  }
}

export const usdcMintService = new USDCMintService();
