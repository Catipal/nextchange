import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  generateMnemonic, validateMnemonic, mnemonicToKeypair,
  signMessage, createOrderMessage, deriveUserId,
  encryptPrivateKey, decryptPrivateKey, formatPublicKey
} from '../crypto/wallet';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // { id, publicKey }
  const [loading, setLoading] = useState(true);
  const [walletExists, setWalletExists] = useState(false);
  const [privateKeyHex, setPrivateKeyHex] = useState(null); // In-memory only, never stored raw

  useEffect(() => {
    // Check if wallet exists in localStorage
    const encryptedKey = localStorage.getItem('nxh_encrypted_key');
    const pubKey = localStorage.getItem('nxh_public_key');
    setWalletExists(!!(encryptedKey && pubKey));

    // Check for active session
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (token && storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setUser(parsed);
        // Try to verify token
        api.get('/auth/me')
          .then(res => setUser(res.data.user))
          .catch(() => {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setUser(null);
          })
          .finally(() => setLoading(false));
      } catch (e) {
        console.error('Failed to parse stored user:', e);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  /**
   * Create a new wallet. Returns the mnemonic for the user to write down.
   */
  const createWallet = useCallback(async (pin) => {
    const mnemonic = await generateMnemonic();
    const { privateKeyHex: privKey, publicKeyHex: pubKey } = await mnemonicToKeypair(mnemonic);

    // Encrypt private key with PIN
    const encrypted = await encryptPrivateKey(privKey, pin);
    localStorage.setItem('nxh_encrypted_key', encrypted);
    localStorage.setItem('nxh_public_key', pubKey);

    setWalletExists(true);
    return { mnemonic, publicKey: pubKey };
  }, []);

  /**
   * Restore wallet from mnemonic.
   */
  const restoreWallet = useCallback(async (mnemonic, pin) => {
    const valid = await validateMnemonic(mnemonic);
    if (!valid) throw new Error('Invalid seed phrase');

    const { privateKeyHex: privKey, publicKeyHex: pubKey } = await mnemonicToKeypair(mnemonic);
    const encrypted = await encryptPrivateKey(privKey, pin);
    localStorage.setItem('nxh_encrypted_key', encrypted);
    localStorage.setItem('nxh_public_key', pubKey);

    setWalletExists(true);
    return { publicKey: pubKey };
  }, []);

  /**
   * Unlock wallet with PIN and authenticate with server.
   */
  const unlockWallet = useCallback(async (pin) => {
    const encrypted = localStorage.getItem('nxh_encrypted_key');
    const pubKey = localStorage.getItem('nxh_public_key');
    if (!encrypted || !pubKey) throw new Error('No wallet found');

    // Decrypt private key
    let privKey;
    try {
      privKey = await decryptPrivateKey(encrypted, pin);
    } catch {
      throw new Error('Wrong PIN');
    }

    // Register public key with server (idempotent)
    await api.post('/auth/register', { publicKey: pubKey });

    // Challenge-response auth
    const challengeRes = await api.post('/auth/challenge', { publicKey: pubKey });
    const { challengeId, challenge } = challengeRes.data;

    // Sign the challenge
    const signature = await signMessage(privKey, challenge);

    // Verify with server
    const verifyRes = await api.post('/auth/verify', {
      publicKey: pubKey,
      challengeId,
      signature
    });

    const { token, user: userData } = verifyRes.data;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));

    setUser(userData);
    setPrivateKeyHex(privKey);

    return userData;
  }, []);

  /**
   * Sign an order before submission.
   */
  const signOrder = useCallback(async (orderData) => {
    if (!privateKeyHex) throw new Error('Wallet not unlocked');
    const pubKey = localStorage.getItem('nxh_public_key');
    const timestamp = Date.now().toString();
    const message = createOrderMessage({ ...orderData, timestamp });
    const signature = await signMessage(privateKeyHex, message);
    return { ...orderData, publicKey: pubKey, signature, timestamp };
  }, [privateKeyHex]);

  /**
   * Logout — clear session but keep wallet.
   */
  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setPrivateKeyHex(null);
  }, []);

  /**
   * Delete wallet entirely.
   */
  const deleteWallet = useCallback(() => {
    localStorage.removeItem('nxh_encrypted_key');
    localStorage.removeItem('nxh_public_key');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setPrivateKeyHex(null);
    setWalletExists(false);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, loading, walletExists,
      isAuthenticated: !!user,
      publicKey: localStorage.getItem('nxh_public_key'),
      formatPublicKey,
      createWallet, restoreWallet, unlockWallet,
      signOrder, logout, deleteWallet,
      privateKeyHex // Added for native Ethereum integration
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
