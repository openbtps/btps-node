/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * What a device's new key signs when the device moves to it, on an
 * `auth.refresh`: the agent, its identity and the new key itself. The refresh
 * as a whole is signed by the current key, so the two signatures together
 * show that one device holds both keys.
 */
export const keyProofPayload = (agentId: string, identity: string, publicKey: string) => ({
  type: 'btps_key_proof',
  agentId,
  identity,
  publicKey,
});
