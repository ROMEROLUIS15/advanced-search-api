import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ServiceIndexController } from './service-index.controller';

describe('ServiceIndexController', () => {
  it('lists every publicly routed endpoint', () => {
    // Arrange
    const controller = new ServiceIndexController();

    // Act
    const index = controller.index();

    // Assert
    expect(Object.keys(index.endpoints)).toEqual([
      'GET /search',
      'GET /autocomplete',
      'GET /suggest',
      'GET /health',
    ]);
  });

  it('describes the service and links to its docs', () => {
    // Arrange
    const controller = new ServiceIndexController();

    // Act
    const index = controller.index();

    // Assert
    expect(index.name).toBe('Advanced Product Search API');
    expect(index.docs).toMatch(/^https:\/\//);
  });

  it('reports the same version as package.json', () => {
    // Arrange
    const packageJsonPath = join(__dirname, '..', '..', '..', 'package.json');
    const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };

    // Act
    const index = new ServiceIndexController().index();

    // Assert
    expect(index.version).toBe(version);
  });
});
