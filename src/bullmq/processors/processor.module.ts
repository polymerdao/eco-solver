import { Module } from '@nestjs/common'
import { EthWebsocketProcessor } from './eth-ws.processor'
import { SignerProcessor } from './signer.processor'
import { SolveIntentProcessor } from './solve-intent.processor'
import { BalanceModule } from '../../balance/balance.module'
import { IntentModule } from '../../intent/intent.module'
import { SignModule } from '../../sign/sign.module'
import { InboxProcessor } from '@/bullmq/processors/inbox.processor'
import { ProverModule } from '@/prover/prover.module'
import { TransactionModule } from '@/transaction/transaction.module'

@Module({
  imports: [BalanceModule, IntentModule, SignModule, ProverModule, TransactionModule],
  providers: [EthWebsocketProcessor, SignerProcessor, SolveIntentProcessor, InboxProcessor],
})
export class ProcessorModule {}
