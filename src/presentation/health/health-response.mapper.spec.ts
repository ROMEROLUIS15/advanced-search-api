import { toHealthResponseDto } from './health-response.mapper';
import type { HealthReport } from '@application/models/health-report';

describe('toHealthResponseDto', () => {
  it('maps dependencies into a keyed info object, including details when present', () => {
    const report: HealthReport = {
      status: 'ok',
      dependencies: [
        { name: 'elasticsearch', status: 'up', critical: true },
        { name: 'redis', status: 'down', critical: false, detail: 'timeout' },
      ],
    };

    expect(toHealthResponseDto(report)).toEqual({
      status: 'ok',
      info: {
        elasticsearch: { status: 'up' },
        redis: { status: 'down', detail: 'timeout' },
      },
    });
  });
});
