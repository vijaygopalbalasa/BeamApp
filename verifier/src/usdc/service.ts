import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  Connection,
  Keypair,
  PublicKey,
  Commitment,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { SOLANA_NETWORK, SOLANA_RPC_URL } from '../env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface MintConfig {
  network: string;
  mintAddress: string;
  mintAuthority: string;
  decimals: number;
}

export interface MintRequest {
  recipient: PublicKey;
  amount: number;
}

export interface MintResult {
  signature: string;
  amount: number;
  decimals: number;
  tokenAccount: PublicKey;
  mint: PublicKey;
}

const CONFIG_PATH_CANDIDATES = [
  resolve(__dirname, '../scripts/usdc-mint-config.json'),
  process.env.USDC_MINT_CONFIG_PATH,
  resolve(__dirname, '../../scripts/usdc-mint-config.json'),
  resolve(__dirname, '../../../scripts/usdc-mint-config.json'),
  resolve(process.cwd(), 'scripts/usdc-mint-config.json'),
  resolve(process.cwd(), '../scripts/usdc-mint-config.json'),
].filter((value): value is string => Boolean(value));

const AUTHORITY_PATH_CANDIDATES = [
  resolve(__dirname, '../scripts/usdc-mint-authority.json'),
  process.env.USDC_MINT_AUTHORITY_PATH,
  resolve(__dirname, '../../scripts/usdc-mint-authority.json'),
  resolve(__dirname, '../../../scripts/usdc-mint-authority.json'),
  resolve(process.cwd(), 'scripts/usdc-mint-authority.json'),
  resolve(process.cwd(), '../scripts/usdc-mint-authority.json'),
].filter((value): value is string => Boolean(value));
const CONNECTION_COMMITMENT: Commitment = 'confirmed';

let cachedConnection: Connection | null = null;
let cachedConfig: MintConfig | null = null;
let cachedAuthority: Keypair | null = null;

export class MintServiceError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'MintServiceError';
  }
}

function getConnection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(SOLANA_RPC_URL, CONNECTION_COMMITMENT);
  }
  return cachedConnection;
}

function loadConfigPath(): string {
  for (const candidate of CONFIG_PATH_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new MintServiceError(
    `USDC mint configuration not found. Checked: ${CONFIG_PATH_CANDIDATES.join(', ')}`,
    'MINT_CONFIG_MISSING'
  );
}

function loadAuthorityPath(): string {
  for (const candidate of AUTHORITY_PATH_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new MintServiceError(
    `USDC mint authority not found. Checked: ${AUTHORITY_PATH_CANDIDATES.join(', ')}`,
    'MINT_AUTHORITY_MISSING'
  );
}

function loadConfig(): MintConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const configPath = loadConfigPath();
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as MintConfig;
    if (!parsed.mintAddress || !parsed.decimals) {
      throw new Error('Invalid mint configuration file');
    }

    if (parsed.network && parsed.network !== SOLANA_NETWORK) {
      console.warn(
        `[usdc] Mint config network (${parsed.network}) does not match verifier network (${SOLANA_NETWORK}).`
      );
    }

    cachedConfig = parsed;
    return parsed;
  } catch (err) {
    if (err instanceof MintServiceError) {
      throw err;
    }
    throw new MintServiceError(`Failed to load USDC mint configuration: ${err instanceof Error ? err.message : String(err)}`, 'MINT_CONFIG_MISSING');
  }
}

function loadAuthority(): Keypair {
  if (cachedAuthority) {
    return cachedAuthority;
  }

  try {
    const authorityPath = loadAuthorityPath();
    const raw = readFileSync(authorityPath, 'utf-8');
    const secret = JSON.parse(raw) as number[];
    cachedAuthority = Keypair.fromSecretKey(new Uint8Array(secret));
    return cachedAuthority;
  } catch (err) {
    if (err instanceof MintServiceError) {
      throw err;
    }
    throw new MintServiceError(`Failed to load USDC mint authority: ${err instanceof Error ? err.message : String(err)}`, 'MINT_AUTHORITY_MISSING');
  }
}

export async function mintDevnetUsdc(request: MintRequest): Promise<MintResult> {
  if (request.amount <= 0) {
    throw new MintServiceError('Amount must be greater than zero', 'INVALID_AMOUNT');
  }

  const config = loadConfig();
  const connection = getConnection();
  const authority = loadAuthority();
  const mint = new PublicKey(config.mintAddress);

  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    request.recipient,
    false,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const decimalFactor = Math.pow(10, config.decimals);
  const amountUnits = BigInt(Math.round(request.amount * decimalFactor));
  if (amountUnits <= 0n) {
    throw new MintServiceError('Amount too small for configured decimals', 'INVALID_AMOUNT');
  }

  const signature = await mintTo(
    connection,
    authority,
    mint,
    tokenAccount.address,
    authority,
    amountUnits,
    [],
    undefined,
    TOKEN_PROGRAM_ID
  );

  return {
    signature,
    amount: request.amount,
    decimals: config.decimals,
    tokenAccount: tokenAccount.address,
    mint,
  };
}
