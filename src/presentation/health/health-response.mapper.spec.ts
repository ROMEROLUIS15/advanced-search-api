import { toHealthResponseDto } from './health-response.mapper';
import type { HealthReport } from '@application/models/health-report';

describe('toHealthResponseDto', () => {
  it('maps dependency statuses without exposing internal failure details', () => {
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
        redis: { status: 'down' },
      },
    });
  });
});
