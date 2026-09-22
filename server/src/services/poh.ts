/**
 * Simulated proof-of-history anchoring for the test-run log.
 *
 * SIMULATED — there is no Solana connection here. Each history entry derives a
 * Solana-shaped anchor (hash, slot, signature) deterministically from its own
 * content chained onto the previous entry, using only Node's built-in crypto.
 * No network calls, no dependencies, works offline.
 *
 * This module is the single choke point for a future live integration: replace
 * the three exported functions with `@solana/web3.js` memo anchoring and
 * transaction verification, keeping the shapes identical. Callers (the history
 * route, the test-history page) must never hash, encode, or verify outside it.
 */

import crypto from 'node:crypto';

export const POH_MODE = 'simulated' as const;
export const POH_CLUSTER = 'devnet' as const;

/** One entry's anchor as served to clients. */
export interface PohAnchor {
  /** Short chain hash (base58, 44 chars like an account address). */
  hash: string;
  /** Simulated slot, ascending with time. */
  slot: number;
  /** Simulated transaction signature (base58, 88 chars). */
  signature: string;
}

export interface PohChainInput {
  id: number;
  projectId: number;
  testTypeCode: string;
  verdict: string;
  updatedAt: string;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58-encode bytes (Bitcoin/IPFS alphabet, same one Solana uses). */
function base58(data: Buffer): string {
  let num = 0n;
  for (const byte of data) num = (num << 8n) | BigInt(byte);
  let out = '';
  while (num > 0n) {
    out = BASE58[Number(num % 58n)] + out;
    num = num / 58n;
  }
  for (const byte of data) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out || '1';
}

function sha256Hex(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

/** Canonical payload: the fields whose tampering the chain would expose. */
function canonical(entry: PohChainInput): string {
  return [entry.id, entry.projectId, entry.testTypeCode, entry.verdict, entry.updatedAt].join('|');
}

/**
 * Anchor a project's entries oldest-first so each hash covers its predecessor.
 * Slots step ~2.5/s (one per 400 ms) from a fixed devnet-plausible base.
 */
export function pohAnchorChain(entries: PohChainInput[]): Map<number, PohAnchor> {
  const ordered = [...entries].sort(
    (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
  );
  const anchors = new Map<number, PohAnchor>();
  let prev = sha256Hex(['NAWI-POH', 'genesis']);
  let slot = 342_000_000;
  let prevTime = ordered.length > 0 ? new Date(ordered[0]!.updatedAt).getTime() : 0;
  for (const entry of ordered) {
    const hash = sha256Hex([prev, canonical(entry)]);
    const t = new Date(entry.updatedAt).getTime();
    slot += Math.max(1, Math.round(Math.max(0, t - prevTime) / 400));
    prevTime = t;
    const sigBytes = Buffer.concat([
      crypto.createHash('sha256').update(hash).digest(),
      crypto.createHash('sha256').update(prev + canonical(entry)).digest(),
    ]);
    anchors.set(entry.id, {
      hash: base58(Buffer.from(hash, 'hex').subarray(0, 32)),
      slot,
      signature: base58(sigBytes),
    });
    prev = hash;
  }
  return anchors;
}

/** Recompute the chain and compare: true when nothing was altered. */
export function pohVerify(entries: PohChainInput[], anchors: Map<number, PohAnchor>): boolean {
  const fresh = pohAnchorChain(entries);
  if (fresh.size !== anchors.size) return false;
  for (const [id, anchor] of fresh) {
    const have = anchors.get(id);
    if (!have || have.hash !== anchor.hash || have.slot !== anchor.slot) return false;
  }
  return true;
}

export function pohStatus(): { mode: typeof POH_MODE; cluster: typeof POH_CLUSTER } {
  return { mode: POH_MODE, cluster: POH_CLUSTER };
}
