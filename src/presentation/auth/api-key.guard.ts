import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { OPERATOR_PATHS, matchesPath } from '@shared/operator-paths';
import { API_KEY_HEADER, type KeyIdentifier, createKeyIdentifier } from './api-key.identity';

/**
 * Requires a valid `X-API-Key` on every client endpoint (design D30–D32).
 *
 * The exemptions are the operator paths, and neither of them is thereby open:
 * `/health` is a public probe by design — the platform cannot send a header and
 * a 401 there reads as an unhealthy instance — and `/metrics` carries its own
 * bearer token (D23), so stacking an application key on it would force a
 * monitoring agent to hold a credential it has no other use for.
 *
 * `/docs` and `/docs-json` are **not** exempt. The contract describes every
 * parameter of a catalogue that is not meant to be read by strangers; serving it
 * while gating the data would be a lock on the door with the blueprints taped to
 * the window.
 *
 * Registered after the rate-limit guard on purpose, so an unauthenticated flood
 * still consumes a budget instead of being rejected for free.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly enabled: boolean;
  private readonly identify: KeyIdentifier;

  constructor(@Inject(APP_CONFIG) config: AppConfiguration) {
    this.enabled = config.apiAuth.enabled;
    this.identify = createKeyIdentifier(config.apiAuth.keys);
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.enabled) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    if (matchesPath(request.url, OPERATOR_PATHS)) {
      return true;
    }
    if (this.identify(presentedKey(request)) === undefined) {
      // Deliberately says nothing about *why* — absent, malformed and unknown
      // are one answer, and the key is never echoed back or logged.
      throw new UnauthorizedException(`A valid ${API_KEY_HEADER} header is required`);
    }
    return true;
  }
}

function presentedKey(request: Request): string | undefined {
  const header = request.headers[API_KEY_HEADER];
  return Array.isArray(header) ? header[0] : header;
}
