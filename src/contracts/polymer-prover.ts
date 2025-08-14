/**
 * PolymerProver ABI (matches the updated PolymerProver.sol contract)
 * 
 * Core functions:
 * - validate(): Validates a single proof and processes the intent
 * - validateBatch(): Validates multiple proofs in one transaction
 * - getProofType(): Returns "Polymer" to identify the prover type
 * - prove(): Emits IntentFulfilledFromSource events for Polymer proof generation
 * - initialize(): Owner-only initialization function (called after deployment)
 */
export const PolymerProverAbi = [
  {
    inputs: [
      { internalType: 'bytes', name: 'proof', type: 'bytes' }
    ],
    name: 'validate',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'bytes[]', name: 'proofs', type: 'bytes[]' }
    ],
    name: 'validateBatch',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getProofType',
    outputs: [
      { internalType: 'string', name: '', type: 'string' }
    ],
    stateMutability: 'pure',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'sender', type: 'address' },
      { internalType: 'uint64', name: 'sourceChainDomainID', type: 'uint64' },
      { internalType: 'bytes', name: 'encodedProofs', type: 'bytes' },
      { internalType: 'bytes', name: 'data', type: 'bytes' }
    ],
    name: 'prove',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: '_crossL2ProverV2', type: 'address' },
      { internalType: 'uint64[]', name: '_chainIds', type: 'uint64[]' },
      { internalType: 'bytes32[]', name: '_whitelistedEmitters', type: 'bytes32[]' }
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'intentHash', type: 'bytes32' },
      { indexed: true, internalType: 'bytes32', name: 'claimant', type: 'bytes32' },
      { indexed: false, internalType: 'uint64', name: 'destination', type: 'uint64' }
    ],
    name: 'IntentFulfilledFromSource',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'intentHash', type: 'bytes32' },
      { indexed: true, internalType: 'address', name: 'claimant', type: 'address' },
      { indexed: false, internalType: 'uint64', name: 'destination', type: 'uint64' }
    ],
    name: 'IntentProven',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'intentHash', type: 'bytes32' }
    ],
    name: 'IntentAlreadyProven',
    type: 'event'
  }
] as const