import { Module } from '@nestjs/common';
import { ClientIpController } from '@presentation/diagnostics/client-ip.controller';

/**
 * TEMPORARY module for the `GET /debug/client-ip` diagnostic. Static — no ports,
 * no dependencies beyond the global config. Remove this file and its import in
 * `app.module.ts` once Render's proxy hop count is confirmed.
 */
@Module({
  controllers: [ClientIpController],
})
export class DiagnosticsModule {}
