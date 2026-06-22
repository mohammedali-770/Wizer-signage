import { Module } from '@nestjs/common';

import { DeviceModule } from '../device/device.module';
import { DeviceProofOfPlayController } from './device-proof-of-play.controller';
import { ProofOfPlayController } from './proof-of-play.controller';
import { ProofOfPlayService } from './proof-of-play.service';

/**
 * Phase 9 — Proof-of-Play. Imports DeviceModule for the exported DeviceAuthGuard
 * (device ingest route). Prisma + storage are global.
 */
@Module({
  imports: [DeviceModule],
  controllers: [DeviceProofOfPlayController, ProofOfPlayController],
  providers: [ProofOfPlayService],
  exports: [ProofOfPlayService],
})
export class ProofOfPlayModule {}
