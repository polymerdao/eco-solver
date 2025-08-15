import { Test, TestingModule } from '@nestjs/testing'
import { createMock, DeepMocked } from '@golevelup/ts-jest'
import { Hex } from 'viem'
import { InboxProcessor } from '../inbox.processor'

// Mock viem parseEventLogs function
jest.mock('viem', () => ({
  ...jest.requireActual('viem'),
  parseEventLogs: jest.fn(),
}))
import { UtilsIntentService } from '@/intent/utils-intent.service'
import { ProofService } from '@/prover/proof.service'
import { MultichainPublicClientService } from '@/transaction/multichain-public-client.service'
import { WalletClientDefaultSignerService } from '@/transaction/smart-wallets/wallet-client.service'
import { EcoConfigService } from '@/eco-configs/eco-config.service'

describe('InboxProcessor', () => {
  let processor: InboxProcessor
  let utilsIntentService: DeepMocked<UtilsIntentService>
  let proofService: DeepMocked<ProofService>
  let multichainPublicClientService: DeepMocked<MultichainPublicClientService>
  let walletClientDefaultSignerService: DeepMocked<WalletClientDefaultSignerService>
  let ecoConfigService: DeepMocked<EcoConfigService>

  const mockIntentHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
  const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex
  const mockProverAddress = '0x1111111111111111111111111111111111111111' as Hex
  const sourceChainId = 1
  const destinationChainId = 137

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks()
    
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboxProcessor,
        { provide: UtilsIntentService, useValue: createMock<UtilsIntentService>() },
        { provide: ProofService, useValue: createMock<ProofService>() },
        { provide: MultichainPublicClientService, useValue: createMock<MultichainPublicClientService>() },
        { provide: WalletClientDefaultSignerService, useValue: createMock<WalletClientDefaultSignerService>() },
        { provide: EcoConfigService, useValue: createMock<EcoConfigService>() },
      ],
    }).compile()

    processor = module.get<InboxProcessor>(InboxProcessor)
    utilsIntentService = module.get(UtilsIntentService)
    proofService = module.get(ProofService)
    multichainPublicClientService = module.get(MultichainPublicClientService)
    walletClientDefaultSignerService = module.get(WalletClientDefaultSignerService)
    ecoConfigService = module.get(EcoConfigService)
  })

  describe('handlePolymerProofSubmission', () => {

    describe('happy path', () => {
      it('should successfully complete Polymer proof submission flow', async () => {
        // Setup mocks
        const mockIntentModel = {
          intent: {
            hash: mockIntentHash,
            route: {
              salt: '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
              source: BigInt(sourceChainId),
              destination: BigInt(destinationChainId),
              inbox: '0x5555555555555555555555555555555555555555' as Hex,
              tokens: [],
              calls: [{ target: '0x6666666666666666666666666666666666666666' as Hex, data: '0x' as Hex, value: BigInt(0) }],
            },
            reward: {
              creator: '0x7777777777777777777777777777777777777777' as Hex,
              prover: mockProverAddress,
              deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
              nativeValue: BigInt(0),
              tokens: [],
            },
            logIndex: 0,
          },
          status: 'PENDING',
        } as any
        const mockFulfillmentLog = {
          args: {
            _hash: mockIntentHash,
            _sourceChainID: BigInt(sourceChainId),
            _prover: mockProverAddress,
            _claimant: '0x9999999999999999999999999999999999999999' as Hex,
          },
          transactionHash: mockTxHash,
        } as any
        
        utilsIntentService.getIntentModel.mockResolvedValue(mockIntentModel as any)
        proofService.isPolymerProver.mockReturnValue(true)
        ecoConfigService.getPolymerProverAddress
          .mockReturnValueOnce(mockProverAddress) // destination chain
          .mockReturnValueOnce(mockProverAddress) // source chain

        // Mock findPolymerProverEvent
        const mockPolymerEvent = {
          blockNumber: 12345n,
          logIndex: 0,
          intentHash: mockIntentHash,
          destinationChainId,
        }
        jest.spyOn(processor as any, 'findPolymerProverEvent').mockResolvedValue(mockPolymerEvent)

        // Mock generateAndSubmitPolymerProof
        jest.spyOn(processor as any, 'generateAndSubmitPolymerProof').mockResolvedValue(undefined)

        // Execute
        await processor['handlePolymerProofSubmission'](mockFulfillmentLog)

        // Verify flow
        expect(utilsIntentService.getIntentModel).toHaveBeenCalledWith(mockIntentHash)
        expect(proofService.isPolymerProver).toHaveBeenCalledWith(sourceChainId, mockProverAddress)
        expect(processor['findPolymerProverEvent']).toHaveBeenCalledWith(
          destinationChainId,
          mockTxHash,
          mockIntentHash,
          mockProverAddress
        )
        expect(processor['generateAndSubmitPolymerProof']).toHaveBeenCalledWith(
          mockPolymerEvent,
          sourceChainId,
          mockProverAddress
        )
      })

      it('should handle different source and destination chain configurations', async () => {
        const intentProverAddress = '0x4444444444444444444444444444444444444444' as Hex // The prover specified in the intent
        const destProverAddress = '0x2222222222222222222222222222222222222222' as Hex   // Polymer prover on destination chain
        const sourceProverAddress = '0x3333333333333333333333333333333333333333' as Hex // Polymer prover on source chain
        
        const mockIntentModel = {
          intent: {
            hash: mockIntentHash,
            route: {
              salt: '0x0000000000000000000000000000000000000000000000000000000000000002' as Hex,
              source: BigInt(42),
              destination: BigInt(56),
              inbox: '0x5555555555555555555555555555555555555555' as Hex,
              tokens: [],
              calls: [{ target: '0x6666666666666666666666666666666666666666' as Hex, data: '0x' as Hex, value: BigInt(0) }],
            },
            reward: {
              creator: '0x7777777777777777777777777777777777777777' as Hex,
              prover: intentProverAddress, // The prover specified in the intent
              deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
              nativeValue: BigInt(0),
              tokens: [],
            },
            logIndex: 0,
          },
          status: 'PENDING',
        } as any
        const mockFulfillmentLog = {
          args: {
            _hash: mockIntentHash,
            _sourceChainID: BigInt(42),
            _prover: intentProverAddress,
            _claimant: '0x9999999999999999999999999999999999999999' as Hex,
          },
          transactionHash: mockTxHash,
        } as any
        
        utilsIntentService.getIntentModel.mockResolvedValue(mockIntentModel as any)
        proofService.isPolymerProver.mockReturnValue(true)
        
        ecoConfigService.getPolymerProverAddress
          .mockReturnValueOnce(destProverAddress)   // destination chain (56)
          .mockReturnValueOnce(sourceProverAddress) // source chain (42)

        const mockPolymerEvent = {
          blockNumber: 54321n,
          logIndex: 1,
          intentHash: mockIntentHash,
          destinationChainId: 56,
        }
        jest.spyOn(processor as any, 'findPolymerProverEvent').mockResolvedValue(mockPolymerEvent)
        jest.spyOn(processor as any, 'generateAndSubmitPolymerProof').mockResolvedValue(undefined)

        await processor['handlePolymerProofSubmission'](mockFulfillmentLog)

        expect(proofService.isPolymerProver).toHaveBeenCalledWith(42, intentProverAddress)
        expect(ecoConfigService.getPolymerProverAddress).toHaveBeenNthCalledWith(1, 56) // destination
        expect(ecoConfigService.getPolymerProverAddress).toHaveBeenNthCalledWith(2, 42) // source
        expect(processor['findPolymerProverEvent']).toHaveBeenCalledWith(
          56, mockTxHash, mockIntentHash, destProverAddress
        )
        expect(processor['generateAndSubmitPolymerProof']).toHaveBeenCalledWith(
          mockPolymerEvent, 42, sourceProverAddress
        )
      })
    })

    describe('early returns and edge cases', () => {
      it('should return early when not a Polymer prover', async () => {
        // Only need minimal data for the isPolymerProver check
        const mockIntentModel = {
          intent: {
            route: { source: BigInt(sourceChainId) },
            reward: { prover: mockProverAddress },
          },
        } as any
        const mockFulfillmentLog = {
          args: { _hash: mockIntentHash },
        } as any
        
        utilsIntentService.getIntentModel.mockResolvedValue(mockIntentModel as any)
        proofService.isPolymerProver.mockReturnValue(false)

        const findEventSpy = jest.spyOn(processor as any, 'findPolymerProverEvent')

        await processor['handlePolymerProofSubmission'](mockFulfillmentLog)

        expect(proofService.isPolymerProver).toHaveBeenCalledWith(sourceChainId, mockProverAddress)
        expect(findEventSpy).not.toHaveBeenCalled()
      })

      it('should handle missing IntentFulfilledFromSource event gracefully', async () => {
        const mockIntentModel = {
          intent: {
            hash: mockIntentHash,
            route: {
              salt: '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
              source: BigInt(sourceChainId),
              destination: BigInt(destinationChainId),
              inbox: '0x5555555555555555555555555555555555555555' as Hex,
              tokens: [],
              calls: [{ target: '0x6666666666666666666666666666666666666666' as Hex, data: '0x' as Hex, value: BigInt(0) }],
            },
            reward: {
              creator: '0x7777777777777777777777777777777777777777' as Hex,
              prover: mockProverAddress,
              deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
              nativeValue: BigInt(0),
              tokens: [],
            },
            logIndex: 0,
          },
          status: 'PENDING',
        } as any
        const mockFulfillmentLog = {
          args: {
            _hash: mockIntentHash,
            _sourceChainID: BigInt(sourceChainId),
            _prover: mockProverAddress,
            _claimant: '0x9999999999999999999999999999999999999999' as Hex,
          },
          transactionHash: mockTxHash,
        } as any
        
        utilsIntentService.getIntentModel.mockResolvedValue(mockIntentModel as any)
        proofService.isPolymerProver.mockReturnValue(true)
        ecoConfigService.getPolymerProverAddress.mockReturnValue(mockProverAddress)

        jest.spyOn(processor as any, 'findPolymerProverEvent').mockResolvedValue(null)
        const generateProofSpy = jest.spyOn(processor as any, 'generateAndSubmitPolymerProof')

        await processor['handlePolymerProofSubmission'](mockFulfillmentLog)

        expect(generateProofSpy).not.toHaveBeenCalled()
      })
    })
  })

  describe('findPolymerProverEvent', () => {
    const mockChainId = 137
    const mockBlockNumber = 12345n
    const mockLogIndex = 0

    it('should find IntentFulfilledFromSource event in transaction receipt', async () => {
      const mockClient = {
        getTransactionReceipt: jest.fn(),
      }
      multichainPublicClientService.getClient.mockResolvedValue(mockClient as any)

      const mockReceipt = {
        blockNumber: mockBlockNumber,
        logs: [
          {
            address: mockProverAddress,
            topics: ['0xIntentFulfilledFromSourceSignature'],
            data: '0xEventData',
          },
        ],
      }
      mockClient.getTransactionReceipt.mockResolvedValue(mockReceipt)

      // Mock parseEventLogs function from viem
      // IntentFulfilledFromSource event has: intentHash (bytes32), claimant (bytes32), destination (uint64)
      const mockParsedLogs = [
        {
          args: { 
            intentHash: mockIntentHash,
            claimant: '0x0000000000000000000000009999999999999999999999999999999999999999' as Hex, // bytes32 representation of claimant
            destination: BigInt(mockChainId)
          },
          logIndex: mockLogIndex,
        },
      ]
      
      const { parseEventLogs } = require('viem')
      parseEventLogs.mockReturnValue(mockParsedLogs)

      const result = await processor['findPolymerProverEvent'](
        mockChainId,
        mockTxHash,
        mockIntentHash,
        mockProverAddress
      )

      expect(result).toEqual({
        blockNumber: mockBlockNumber,
        logIndex: mockLogIndex,
        intentHash: mockIntentHash,
        destinationChainId: mockChainId,
      })

      expect(mockClient.getTransactionReceipt).toHaveBeenCalledWith({
        hash: mockTxHash,
      })
    })

    it('should return null when no matching event found', async () => {
      const mockClient = {
        getTransactionReceipt: jest.fn(),
      }
      multichainPublicClientService.getClient.mockResolvedValue(mockClient as any)

      const mockReceipt = {
        blockNumber: mockBlockNumber,
        logs: [], // No logs
      }
      mockClient.getTransactionReceipt.mockResolvedValue(mockReceipt)

      // Mock parseEventLogs to return empty array for no logs
      const { parseEventLogs } = require('viem')
      parseEventLogs.mockReturnValue([])

      const result = await processor['findPolymerProverEvent'](
        mockChainId,
        mockTxHash,
        mockIntentHash,
        mockProverAddress
      )

      expect(result).toBeNull()
    })
  })

  describe('generateAndSubmitPolymerProof', () => {
    const mockPolymerEvent = {
      blockNumber: 12345n,
      logIndex: 0,
      intentHash: mockIntentHash,
      destinationChainId,
    }

    it('should successfully generate and submit Polymer proof', async () => {
      const mockJobId = 'polymer-job-123'
      const mockProofBase64 = 'base64ProofData=='
      
      proofService.requestPolymerProof.mockResolvedValue(mockJobId)
      proofService.waitForPolymerProof.mockResolvedValue(mockProofBase64)

      const submitProofSpy = jest.spyOn(processor as any, 'submitPolymerProofOnChain')
        .mockResolvedValue(undefined)

      await processor['generateAndSubmitPolymerProof'](
        mockPolymerEvent,
        sourceChainId,
        mockProverAddress
      )

      expect(proofService.requestPolymerProof).toHaveBeenCalledWith(
        destinationChainId, // Source chain where event was emitted
        Number(mockPolymerEvent.blockNumber),
        mockPolymerEvent.logIndex,
        sourceChainId // Destination chain for proof
      )

      expect(proofService.waitForPolymerProof).toHaveBeenCalledWith(mockJobId)

      expect(submitProofSpy).toHaveBeenCalledWith(
        mockProofBase64,
        mockIntentHash,
        sourceChainId,
        mockProverAddress
      )
    })

    it('should handle Polymer API request errors', async () => {
      proofService.requestPolymerProof.mockRejectedValue(
        new Error('Polymer API unavailable')
      )

      await expect(
        processor['generateAndSubmitPolymerProof'](
          mockPolymerEvent,
          sourceChainId,
          mockProverAddress
        )
      ).rejects.toThrow('Polymer API unavailable')
    })

    it('should handle proof generation timeout', async () => {
      const mockJobId = 'polymer-job-timeout'
      proofService.requestPolymerProof.mockResolvedValue(mockJobId)
      proofService.waitForPolymerProof.mockRejectedValue(
        new Error('Proof generation timeout')
      )

      await expect(
        processor['generateAndSubmitPolymerProof'](
          mockPolymerEvent,
          sourceChainId,
          mockProverAddress
        )
      ).rejects.toThrow('Proof generation timeout')
    })
  })

  describe('submitPolymerProofOnChain', () => {
    const mockProofBase64 = 'dGVzdFByb29mRGF0YQ==' // base64 encoded "testProofData"
    const expectedProofHex = '0x74657374507266446174' as Hex

    it('should successfully submit proof to blockchain', async () => {
      const mockWalletClient = {
        writeContract: jest.fn(),
      }
      walletClientDefaultSignerService.getClient.mockResolvedValue(mockWalletClient as any)

      const mockTxHash = '0xproofSubmissionTxHash'
      mockWalletClient.writeContract.mockResolvedValue(mockTxHash)

      await processor['submitPolymerProofOnChain'](
        mockProofBase64,
        mockIntentHash,
        sourceChainId,
        mockProverAddress
      )

      expect(mockWalletClient.writeContract).toHaveBeenCalledWith({
        address: mockProverAddress,
        abi: expect.any(Array), // PolymerProverAbi
        functionName: 'validate',
        args: [expect.stringMatching(/^0x[0-9a-f]+$/i)], // Hex proof
      })
    })
  })
})
