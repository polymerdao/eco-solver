import { EcoChainConfig, EcoProtocolAddresses } from '@eco-foundation/routes-ts'
import * as config from 'config'
import { EcoError } from '../common/errors/eco-error'

/**
 * The prefix for non-production deploys on a chain
 */
export const ChainPrefix = 'pre'

export enum NodeEnv {
  production = 'production',
  preproduction = 'preproduction',
  staging = 'staging',
  development = 'development',
}

/**
 * Returns the NodeEnv enum value from the string node env, defaults to Development
 *
 * @param env the string node env
 * @returns
 */
export function getNodeEnv(): NodeEnv {
  const env: string = config.util.getEnv('NODE_ENV')
  const normalizedEnv = env.toLowerCase() as keyof typeof NodeEnv
  return NodeEnv[normalizedEnv] || NodeEnv.development
}

/**
 * @returns true if the node env is preproduction or development
 */
export function isPreEnv(): boolean {
  return (
    getNodeEnv() === NodeEnv.preproduction ||
    getNodeEnv() === NodeEnv.development ||
    getNodeEnv() === NodeEnv.staging
  )
}

/**
 * Gets the chain configuration for the given chain id from the
 * eco protocol addresses library
 * @param chainID the chain id
 * @returns
 */
export function getChainConfig(chainID: number | string): EcoChainConfig {
  const id = isPreEnv() ? `${chainID}-${ChainPrefix}` : chainID.toString()
  const config = EcoProtocolAddresses[id]
  if (config === undefined) {
    throw EcoError.ChainConfigNotFound(id)
  }
  return config
}

/**
 * Get PolymerProver address for a given chain
 * TODO: This should come from @eco-foundation/routes-ts eventually
 */
export function getPolymerProverAddress(chainID: number): string | undefined {
  const env = isPreEnv() ? 'pre' : 'prod'
  
  // Temporary mapping until @eco-foundation/routes-ts is updated
  const polymerProvers: Record<string, Record<number, string>> = {
    pre: {
      11155111: '0x...', // Sepolia PolymerProver
      84532: '0x...',    // Base Sepolia PolymerProver
      421614: '0x...',   // Arbitrum Sepolia PolymerProver
    },
    prod: {
      1: '0x...',        // Ethereum PolymerProver
      8453: '0x...',     // Base PolymerProver
      42161: '0x...',    // Arbitrum PolymerProver
    }
  }
  
  return polymerProvers[env]?.[chainID]
}
