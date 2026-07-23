import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';

/**
 * TEMPORARY diagnostic — remove once Render's proxy hop count is confirmed.
 *
 * Rate limiting identifies a client by `req.ip`, which Express derives from
 * `X-Forwarded-For` under the `trust proxy` hop count in `TRUST_PROXY_HOPS`
 * (design D16). If that count does not match the platform's real proxy depth,
 * `req.ip` resolves to an internal proxy address that can vary per request, so a
 * single user scatters across buckets and the limit weakens.
 *
 * This endpoint echoes exactly what the app sees, so the correct hop count can be
 * read straight off the deployed service:
 *   - `xForwardedFor` is the raw chain the platform sent; its leftmost entry is
 *     the real client. Set `TRUST_PROXY_HOPS` so `clientIp` equals that entry.
 *   - `clientIp` / `ipChain` are what Express resolved under the current setting.
 *
 * It exposes only the caller's own request metadata — no secrets, no other
 * client's data — so it is safe to reach while it exists. Delete this file, its
 * module, and the `DiagnosticsModule` import in `app.module.ts` to remove it.
 */
interface ClientIpDiagnostics {
  clientIp: string;
  ipChain: string[];
  xForwardedFor: string | undefined;
  socketRemoteAddress: string | undefined;
  trustProxyHops: number;
  note: string;
}

@Controller('debug')
export class ClientIpController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfiguration) {}

  @Get('client-ip')
  clientIp(@Req() req: Request): ClientIpDiagnostics {
    const forwarded = req.headers['x-forwarded-for'];
    return {
      clientIp: req.ip ?? 'unknown',
      ipChain: req.ips,
      xForwardedFor: Array.isArray(forwarded) ? forwarded.join(', ') : forwarded,
      socketRemoteAddress: req.socket?.remoteAddress,
      trustProxyHops: this.config.rateLimit.trustProxyHops,
      note: 'TEMPORARY diagnostic - remove after confirming Render proxy hops.',
    };
  }
}
