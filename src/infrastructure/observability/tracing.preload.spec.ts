jest.mock('./tracing.bootstrap', () => ({
  startTracing: jest.fn(() => true),
}));

import { startTracing } from './tracing.bootstrap';
import { tracingStarted } from './tracing.preload';

describe('tracing preload', () => {
  it('starts tracing eagerly while the module is evaluated', () => {
    expect(startTracing).toHaveBeenCalledTimes(1);
    expect(tracingStarted).toBe(true);
  });
});
