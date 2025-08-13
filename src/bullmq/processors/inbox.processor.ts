import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { QUEUES } from '@/common/redis/constants'
import { Injectable, Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { EcoLogMessage } from '@/common/logging/eco-log-message'
import { UtilsIntentService } from '@/intent/utils-intent.service'
import { FulfillmentLog } from '@/contracts/inbox'
import { ProofService } from '@/prover/proof.service'
import { MultichainPublicClientService } from '@/transaction/multichain-public-client.service'
import { getPolymerProverAddress } from '@/eco-configs/utils'
import { PolymerProverAbi } from '@/contracts'
import { Hex } from 'viem'

@Injectable()
@Processor(QUEUES.INBOX.queue)
export class InboxProcessor extends WorkerHost {
  private logger = new Logger(InboxProcessor.name)
  constructor(
    private readonly utilsIntentService: UtilsIntentService,
    private readonly proofService: ProofService,
    private readonly multichainPublicClientService: MultichainPublicClientService,
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
   */
  private async handlePolymerProofSubmission(fulfillment: FulfillmentLog) {
    try {
      const model = await this.utilsIntentService.getIntentModel(fulfillment.args._hash)
      if (!model) return

      const sourceChainId = Number(model.intent.route.source)
      const proverAddress = model.intent.reward.prover

      // Check if this intent uses Polymer proving
      const isPolymerProver = this.proofService.isPolymerProver(sourceChainId, proverAddress)
      
      if (isPolymerProver) {
        this.logger.debug(`Starting Polymer proof generation for intent ${fulfillment.args._hash}`)
        
        // Generate and submit proof using existing ProofService
        await this.generateAndSubmitPolymerProof(fulfillment, model, sourceChainId)
      }
    } catch (error) {
      this.logger.error(`Polymer proof handling failed: ${error}`)
      // Don't throw - this is best effort
    }
  }

  /**
   * Generate and submit Polymer proof using existing ProofService
   */
  private async generateAndSubmitPolymerProof(
    fulfillment: FulfillmentLog,
    model: any,
    sourceChainId: number
  ) {
    try {
      // 1. Request proof from Polymer API
      const jobId = await this.proofService.requestPolymerProof(
        Number(fulfillment.address), // destination chain where fulfillment happened
        Number(fulfillment.blockNumber),
        Number(fulfillment.logIndex)
      )

      // 2. Wait for proof completion
      const proofBase64 = await this.proofService.waitForPolymerProof(jobId)

      // 3. Submit proof to PolymerProver contract
      await this.submitPolymerProofOnChain(
        proofBase64,
        fulfillment.args._hash,
        sourceChainId
      )

      this.logger.info(`Polymer proof submitted successfully for intent ${fulfillment.args._hash}`)
    } catch (error) {
      this.logger.error(`Polymer proof generation failed: ${error}`)
      throw error
    }
  }

  /**
   * Submit proof to PolymerProver contract on source chain
   */
  private async submitPolymerProofOnChain(
    proofBase64: string,
    intentHash: Hex,
    sourceChainId: number
  ) {
    // Get PolymerProver address for source chain
    const polymerProverAddress = getPolymerProverAddress(sourceChainId)
    if (!polymerProverAddress) {
      throw new Error(`No PolymerProver contract configured for chain ${sourceChainId}`)
    }

    // Convert base64 proof to hex
    const proofBytes = Buffer.from(proofBase64, 'base64')
    const proofHex = `0x${proofBytes.toString('hex')}` as Hex

    // Get wallet client for source chain
    const client = await this.multichainPublicClientService.getClient(sourceChainId)

    // Submit proof to PolymerProver contract
    const txHash = await client.writeContract({
      address: polymerProverAddress as Hex,
      abi: PolymerProverAbi,
      functionName: 'submitProof',
      args: [proofHex, intentHash, BigInt(sourceChainId)]
    })

    this.logger.info(`Polymer proof submitted in tx: ${txHash}`)
  }
}
