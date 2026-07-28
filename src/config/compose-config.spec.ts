import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateEnv } from './env.schema';

const composePath = resolve(__dirname, '../../docker-compose.yml');
const composeLines = readFileSync(composePath, 'utf8').split(/\r?\n/);

function serviceEnvironment(service: string): Record<string, string> {
  const start = composeLines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) {
    throw new Error(`Compose service "${service}" not found`);
  }

  const environment: Record<string, string> = {};
  for (const line of composeLines.slice(start + 1)) {
    if (/^\s{2}\S/.test(line)) {
      break;
    }
    const entry = line.match(/^\s{6}- ([A-Z][A-Z0-9_]*)=(.*)$/);
    if (entry) {
      environment[entry[1]] = entry[2];
    }
  }
  return environment;
}

describe('docker-compose production configuration', () => {
  it.each(['api', 'seed'])('keeps the %s service valid against the boot schema', (service) => {
    expect(() => validateEnv(serviceEnvironment(service))).not.toThrow();
  });
});
