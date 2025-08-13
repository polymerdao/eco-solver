import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { QUEUES } from '@/common/redis/constants'
import { Injectable, Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { EcoLogMessage } from '@/common/logging/eco-log-message'
import { UtilsIntentService } from '@/intent/utils-intent.service'
import { FulfillmentLog } from '@/contracts/inbox'
import { ProofService } from '@/prover/proof.service'
import { MultichainPublicClientService } from '@/transaction/multichain-public-client.service'
import { EcoConfigService } from '@/eco-configs/eco-config.service'
import { PolymerProverAbi } from '@/contracts'
import { Hex, parseEventLogs } from 'viem'

@Injectable()
@Processor(QUEUES.INBOX.queue)
export class InboxProcessor extends WorkerHost {
  private logger = new Logger(InboxProcessor.name)
  constructor(
    private readonly utilsIntentService: UtilsIntentService,
    private readonly proofService: ProofService,
    private readonly multichainPublicClientService: MultichainPublicClientService,
    private readonly ecoConfigService: EcoConfigService,
  ) {
    super()
  }

  async process(
    job: Job<any, any, string>,
    processToken?: string | undefined, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<any> {
    this.logger.debug(
      EcoLogMessage.fromDefault({
        message: `InboxProcessor: process`,
        properties: {
          job: job.name,
        },
      }),
    )

    switch (job.name) {
      case QUEUES.INBOX.jobs.fulfillment:
        const fulfillment = job.data as FulfillmentLog
        
        // Run fulfillment update and proof submission concurrently
        await Promise.all([
          this.updateFulfillmentStatus(fulfillment),
          this.handlePolymerProofSubmission(fulfillment)
        ])
        
        return
      default:
        this.logger.error(
          EcoLogMessage.fromDefault({
            message: `InboxProcessor: Invalid job type ${job.name}`,
          }),
        )
        return Promise.reject('Invalid job type')
    }
  }

  @OnWorkerEvent('failed')
  onJobFailed(job: Job<any, any, string>, error: Error) {
    this.logger.error(
      EcoLogMessage.fromDefault({
        message: `InboxProcessor: Error processing job`,
        properties: {
          job,
          error,
        },
      }),
    )
  }

  /**
   * Update fulfillment status in database
   */
  private async updateFulfillmentStatus(fulfillment: FulfillmentLog) {
    try {
      await this.utilsIntentService.updateOnFulfillment(fulfillment)
      this.logger.debug(`Fulfillment status updated for intent ${fulfillment.args._hash}`)
    } catch (error) {
      this.logger.error(`Failed to update fulfillment status: ${error}`)
      throw error // Rethrow since this is critical
    }
  }

  /**
   * Handle Polymer proof submission if the intent uses Polymer proving
   * 
   * The flow is:
   * 1. Check if the intent was fulfilled with a Polymer prover
   * 2. Find the IntentFulfilledFromSource event emitted by PolyNativeProver.prove()
   * 3. Request proof for that specific event from Polymer API
   * 4. Submit the proof to the source chain's PolyNativeProver.validate()
   */
  private async handlePolymerProofSubmission(fulfillment: FulfillmentLog) {
    try {
      const model = await this.utilsIntentService.getIntentModel(fulfillment.args._hash)
      if (!model) return

      const sourceChainId = Number(model.intent.route.source)
      const destinationChainId = Number(model.intent.route.destination)
      const proverAddress = model.intent.reward.prover

      // Check if this intent uses Polymer proving by checking if prover address matches for source chain
      const isPolymerProver = this.ecoConfigService.isPolymerProverAddress(proverAddress, sourceChainId)
      
      if (isPolymerProver) {
        this.logger.debug(`Starting Polymer proof generation for intent ${fulfillment.args._hash}`)
        
        // Get the prover address for the destination chain (may be different due to overrides)
        const destProverAddress = this.ecoConfigService.getPolymerProverAddress(destinationChainId)
        // Find the IntentFulfilledFromSource event on the destination chain
        const polymerEvent = await this.findPolymerProverEvent(
          destinationChainId,
          fulfillment.transactionHash as Hex,
          fulfillment.args._hash,
          destProverAddress
        )
        
        if (!polymerEvent) {
          this.logger.error(`Could not find IntentFulfilledFromSource event for intent ${fulfillment.args._hash}`)
          return
        }
        
        // Generate and submit proof for the correct event
        // Get the source chain prover address for submission
        const sourceProverAddress = this.ecoConfigService.getPolymerProverAddress(sourceChainId)
        if (!sourceProverAddress) {
          this.logger.error(`No Polymer prover address configured for source chain ${sourceChainId}`)
          return
        }
        
        await this.generateAndSubmitPolymerProof(polymerEvent, sourceChainId, sourceProverAddress)
      }
    } catch (error) {
      this.logger.error(`Polymer proof handling failed: ${error}`)
      // Don't throw - this is best effort
    }
  }

  /**
   * Find the IntentFulfilledFromSource event emitted by PolyNativeProver
   */
  private async findPolymerProverEvent(
    chainId: number,
    txHash: Hex,
    intentHash: Hex,
    proverAddress: Hex
  ): Promise<{ blockNumber: bigint; logIndex: number; intentHash: Hex; destinationChainId: number } | null> {
    try {
      const client = await this.multichainPublicClientService.getClient(chainId)
      
      // Get the transaction receipt
      const receipt = await client.getTransactionReceipt({ hash: txHash })
      
      // Parse logs to find IntentFulfilledFromSource events from the specific prover address
      const logs = parseEventLogs({
        abi: PolymerProverAbi,
        logs: receipt.logs.filter(log => log.address.toLowerCase() === proverAddress.toLowerCase()),
        eventName: 'IntentFulfilledFromSource'
      })
      
      // Find the log that matches our intent hash
      const polymerLog = logs.find(log => log.args.intentHash === intentHash)
      
      if (polymerLog) {
        return {
          blockNumber: receipt.blockNumber,
          logIndex: polymerLog.logIndex || 0,
          intentHash: polymerLog.args.intentHash,
          destinationChainId: chainId
        }
      }
      
      return null
    } catch (error) {
      this.logger.error(`Failed to find Polymer event: ${error}`)
      return null
    }
  }

  /**
   * Generate and submit Polymer proof for the IntentFulfilledFromSource event
   */
  private async generateAndSubmitPolymerProof(
    polymerEvent: { blockNumber: bigint; logIndex: number; intentHash: Hex; destinationChainId: number },
    sourceChainId: number,
    proverAddress: Hex
  ) {
    try {
      // 1. Request proof from Polymer API for the IntentFulfilledFromSource event
      // The event was emitted on the destination chain, so we use destinationChainId
      const jobId = await this.proofService.requestPolymerProof(
        polymerEvent.destinationChainId, // The destination chain where the event was emitted
        Number(polymerEvent.blockNumber),
        polymerEvent.logIndex
      )

      // 2. Wait for proof completion
      const proofBase64 = await this.proofService.waitForPolymerProof(jobId)

      // 3. Submit proof to PolyNativeProver contract on source chain
      await this.submitPolymerProofOnChain(
        proofBase64,
        polymerEvent.intentHash,
        sourceChainId,
        proverAddress
      )

      this.logger.info(`Polymer proof submitted successfully for intent ${polymerEvent.intentHash}`)
    } catch (error) {
      this.logger.error(`Polymer proof generation failed: ${error}`)
      throw error
    }
  }

  /**
   * Submit proof to PolyNativeProver contract on source chain
   * Note: With the new PolyNativeProver, we only need to submit the proof itself.
   * The prover contract will validate the event and extract the intent hash and claimant.
   */
  private async submitPolymerProofOnChain(
    proofBase64: string,
    intentHash: Hex,
    sourceChainId: number,
    proverAddress: Hex
  ) {
    // Use the prover address directly - it should be the same on source and destination chains

    // Convert base64 proof to hex
    const proofBytes = Buffer.from(proofBase64, 'base64')
    const proofHex = `0x${proofBytes.toString('hex')}` as Hex

    // Get wallet client for source chain
    const client = await this.multichainPublicClientService.getClient(sourceChainId)

    // Submit proof to PolyNativeProver contract using the new validate function
    // The contract will extract the intent hash and claimant from the validated event
    const txHash = await client.writeContract({
      address: proverAddress,
      abi: PolymerProverAbi,
      functionName: 'validate',
      args: [proofHex]
    })

    this.logger.info(`Polymer proof validated in tx: ${txHash} for intent: ${intentHash}`)
  }
}
