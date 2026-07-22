export interface DependencyStatusDto {
  status: 'up' | 'down';
  detail?: string;
}

/** Response body for `GET /health` (design D11). */
export interface HealthResponseDto {
  status: 'ok' | 'error';
  info: Record<string, DependencyStatusDto>;
}
