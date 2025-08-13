import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import * as _ from 'lodash'
import { getAddress, Hex } from 'viem'
import { IProverAbi } from '@eco-foundation/routes-ts'
import { addSeconds, compareAsc } from 'date-fns'
import { ProofCall, ProofType } from '@/contracts'
import { EcoError } from '@/common/errors/eco-error'
import { EcoLogMessage } from '@/common/logging/eco-log-message'
import { EcoConfigService } from '@/eco-configs/eco-config.service'
import { MultichainPublicClientService } from '@/transaction/multichain-public-client.service'

interface ProverMetadata {
  address: Hex
  type: ProofType
  chainID: number
}

/**
 * Service class for getting information about the provers and their configurations.
 */
@Injectable()
export class ProofService implements OnModuleInit {
  private logger = new Logger(ProofService.name)

  /**
   * Variable storing the proof type for each prover address. Used to determine
   * what function to call on the Inbox contract
   */
  private provers: ProverMetadata[] = []

  constructor(
    private readonly publicClient: MultichainPublicClientService,
    private readonly ecoConfigService: EcoConfigService,
  ) {}

  async onModuleInit() {
    await this.loadProofTypes()
  }

  /**
   * Checks if the prover is a hyperlane prover
   * @param chainID
   * @param proverAddress the prover address
   * @returns
   */
  isHyperlaneProver(chainID: number, proverAddress: Hex): boolean {
    return Boolean(this.getProverType(chainID, proverAddress)?.isHyperlane())
  }

  /**
   * Checks if the prover is a metalayer prover
   * @param chainID
   * @param proverAddress the prover address
   * @returns
   */
  isMetalayerProver(chainID: number, proverAddress: Hex): boolean {
    return Boolean(this.getProverType(chainID, proverAddress)?.isMetalayer())
  }

  /**
   * Checks if the prover is a polymer prover
   * @param chainID
   * @param proverAddress the prover address
   * @returns
   */
  isPolymerProver(chainID: number, proverAddress: Hex): boolean {
    return Boolean(this.getProverType(chainID, proverAddress)?.isPolymer())
  }

  /**
   * Returns all the prover addresses for a given proof type
   * @param proofType the proof type
   * @returns
   */
  getProvers(proofType: ProofType): Hex[] {
    const proverAddresses = this.provers
      .filter((prover) => prover.type === proofType)
      .map((prover) => getAddress(prover.address))

    return _.uniq(proverAddresses)
  }

  /**
   * Returns the prover type for a given prover address
   * @param chainID
   * @param proverAddr the prover address
   * @returns
   */
  getProverType(chainID: number, proverAddr: Hex): ProofType | undefined {
    return this.provers.find(
      (prover) => prover.chainID === chainID && prover.address === proverAddr,
    )?.type
  }

  /**
   * Check to see if the expiration of an intent is after the minimum proof time from now.
   *
   * @param chainID
   * @param prover the address of the prover
   * @param expirationDate the expiration date
   * @returns true if the intent can be proven before the minimum proof time, false otherwise
   */
  isIntentExpirationWithinProofMinimumDate(
    chainID: number,
    prover: Hex,
    expirationDate: Date,
  ): boolean {
    const proofType = this.getProverType(chainID, prover)
    if (!proofType) {
      return false
    }
    return compareAsc(expirationDate, this.getProofMinimumDate(proofType)) === 1
  }

  /**
   * Gets the minimum date that a proof can be generated for a given chain id.
   * @param prover
   * @returns
   */
  getProofMinimumDate(prover: ProofType): Date {
    return addSeconds(new Date(), this.getProofMinimumDurationSeconds(prover))
  }

  /**
   * Loads the proof types for each prover address into memory.
   * Assume all provers must have the same proof type if their
   * hex address is the same.
   */
  private async loadProofTypes() {
    const proofPromises = this.ecoConfigService
      .getIntentSources()
      .map((source) => this.getProofTypes(source.chainID, source.provers))

    // get the proof types for each prover address from on chain
    const proofs = await Promise.all(proofPromises)

    this.provers = proofs.flat()

    this.logger.debug(
      EcoLogMessage.fromDefault({
        message: `loadProofTypes loaded all the proof types`,
        properties: {
          proofs: this.provers,
        },
      }),
    )
  }

  /**
   * Fetches all the proof types for the provers on a given chain using {@link ViemMultichainClientService#multicall}
   *
   * @param chainID the chain id
   * @param provers the prover addresses
   * @returns
   */
  private async getProofTypes(chainID: number, provers: Hex[]): Promise<ProverMetadata[]> {
    const client = await this.publicClient.getClient(Number(chainID))
    const proofCalls: ProofCall[] = provers.map((proverAddress) => ({
      address: proverAddress,
      abi: IProverAbi,
      functionName: 'getProofType',
    }))

    const proofTypeResults = await client.multicall({ contracts: proofCalls })

    const proofs: ProverMetadata[] = []

    for (const proverIndex in provers) {
      const proverAddr = provers[proverIndex]
      const { result: proofType, error } = proofTypeResults[proverIndex]

      if (error) {
        this.logger.error(
          EcoLogMessage.fromDefault({
            message: `getProofTypes: error fetching proof type`,
            properties: {
              chainID,
              proverAddr,
              error: error.message,
            },
          }),
        )
        continue
      }

      if (proofType) {
        proofs.push({
          chainID,
          address: proverAddr,
          type: this.getProofTypeFromString(proofType),
        })
      }
    }

    return proofs
  }

  /**
   * Get ProofType from string
   * @param proof
   * @private
   */
  private getProofTypeFromString(proof: string): ProofType {
    return ProofType.fromProviderValue(proof)
  }

  /**
   * The minimum duration that a proof can be generated for a given prover
   *
   * @param prover the address of the prover
   * @returns
   */
  private getProofMinimumDurationSeconds(prover: ProofType): number {
    const proofs = this.ecoConfigService.getIntentConfigs().proofs
    switch (true) {
      case prover.isHyperlane():
        return proofs.hyperlane_duration_seconds
      case prover.isMetalayer():
        return proofs.metalayer_duration_seconds
      case prover.isPolymer():
        return proofs.polymer_duration_seconds
      default:
        throw EcoError.ProverNotSupported(prover)
    }
  }

  /**
   * Get Polymer API configuration for proof generation
   */
  getPolymerConfig() {
    return this.ecoConfigService.getPolymerConfig()
  }

  /**
   * Request proof from Polymer API V1
   */
  async requestPolymerProof(
    srcChainId: number,
    blockNumber: number,
    receiptIndex: number,
    dstChainId?: number
  ): Promise<string> {
    const config = this.getPolymerConfig()
    
    const params = {
      srcChainId,
      srcBlockNumber: blockNumber,
      receiptIndex,
      ...(dstChainId && { dstChainId })
    }
    
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'proof_request',
        params,
        id: 1
      })
    })

    if (!response.ok) {
      throw new Error(`Polymer API request failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    if (data.error) {
      const errorCode = data.error.code
      const errorMessage = data.error.message
      throw new Error(`Polymer API error (${errorCode}): ${errorMessage}`)
    }

    if (!data.result?.jobID) {
      throw new Error('Invalid response: missing jobID')
    }

    return data.result.jobID
  }

  /**
   * Query proof status from Polymer API V1
   */
  async queryPolymerProof(jobID: string): Promise<{status: string, proof?: string, failureReason?: string}> {
    const config = this.getPolymerConfig()
    
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'proof_queryJob',
        params: { jobID },
        id: 1
      })
    })

    if (!response.ok) {
      throw new Error(`Polymer query failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    if (data.error) {
      const errorCode = data.error.code
      const errorMessage = data.error.message
      throw new Error(`Polymer query error (${errorCode}): ${errorMessage}`)
    }

    if (!data.result) {
      throw new Error('Invalid query response: missing result')
    }

    return {
      status: data.result.status,
      proof: data.result.proof,
      failureReason: data.result.failureReason
    }
  }

  /**
   * Wait for Polymer proof completion (follows API polling best practices)
   */
  async waitForPolymerProof(jobID: string, maxAttempts = 30): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.queryPolymerProof(jobID)
      
      if (result.status === 'complete') {
        if (!result.proof) {
          throw new Error('Proof completed but no proof data returned')
        }
        return result.proof
      }
      
      if (result.status === 'error') {
        const errorMsg = result.failureReason || 'Unknown error'
        throw new Error(`Proof generation failed: ${errorMsg}`)
      }
      
      if (result.status === 'not_found') {
        throw new Error(`Proof job not found: ${jobID}`)
      }
      
      // For 'initialized' and 'pending' status, continue polling
      // Wait 2 seconds before retry (30 attempts = 60 seconds total)
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    
    throw new Error(`Proof generation timeout after ${maxAttempts * 2} seconds`)
  }
}
