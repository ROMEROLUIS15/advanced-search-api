import type { Request } from 'express';
import type { AppConfiguration } from '@config/app-config';
import { ClientIpController } from './client-ip.controller';

function config(trustProxyHops: number): AppConfiguration {
  return { rateLimit: { trustProxyHops } } as AppConfiguration;
}

function request(overrides: Partial<Request>): Request {
  return { headers: {}, socket: {}, ips: [], ...overrides } as Request;
}

describe('ClientIpController (temporary diagnostic)', () => {
  it('echoes the resolved ip, the chain and the raw forwarded header', () => {
    // Arrange
    const controller = new ClientIpController(config(1));
    const req = request({
      ip: '203.0.113.7',
      ips: ['203.0.113.7', '10.0.0.1'],
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      socket: { remoteAddress: '10.0.0.1' } as Request['socket'],
    });

    // Act
    const result = controller.clientIp(req);

    // Assert
    expect(result.clientIp).toBe('203.0.113.7');
    expect(result.ipChain).toEqual(['203.0.113.7', '10.0.0.1']);
    expect(result.xForwardedFor).toBe('203.0.113.7, 10.0.0.1');
    expect(result.trustProxyHops).toBe(1);
  });

  it('joins a multi-valued forwarded header and tolerates a missing ip', () => {
    // Arrange
    const controller = new ClientIpController(config(0));
    const req = request({
      ip: undefined,
      headers: { 'x-forwarded-for': ['198.51.100.4', '10.9.9.9'] },
    });

    // Act
    const result = controller.clientIp(req);

    // Assert
    expect(result.clientIp).toBe('unknown');
    expect(result.xForwardedFor).toBe('198.51.100.4, 10.9.9.9');
  });
});
