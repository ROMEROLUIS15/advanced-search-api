import { buildConfig, type AppConfiguration } from './app-config';
import { validateEnv } from './env.schema';

/**
 * Reads and validates the environment (design D12).
 *
 * Exists so that `process.env` is touched in exactly one place even though two
 * callers need configuration at different moments: the `APP_CONFIG` provider,
 * which runs inside the DI container, and the tracing bootstrap, which must run
 * *before* the container exists in order to patch modules as they load
 * (design D25). Both get the same validation and the same fail-fast behaviour.
 */
export function loadConfig(): AppConfiguration {
  return buildConfig(validateEnv(process.env));
}
