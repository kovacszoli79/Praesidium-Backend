import crypto from 'crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length: number): string {
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

// Generate family invite code (6 characters, uppercase alphanumeric)
export const createInviteCode = (): string => {
  return generateCode(6);
};

// Generate child pairing code (XXXX-XXXX format)
export const createPairingCode = (): string => {
  return `${generateCode(4)}-${generateCode(4)}`;
};

// Generate unique ID (21 characters like nanoid)
export const generateId = (): string => {
  const idAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let result = '';
  const bytes = crypto.randomBytes(21);
  for (let i = 0; i < 21; i++) {
    result += idAlphabet[bytes[i] % idAlphabet.length];
  }
  return result;
};
