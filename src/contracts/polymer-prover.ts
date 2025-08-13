export const PolymerProverAbi = [
  {
    inputs: [
      { name: 'proof', type: 'bytes' },
      { name: 'expectedIntentHash', type: 'bytes32' },
      { name: 'expectedSourceChainId', type: 'uint256' }
    ],
    name: 'submitProof',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const