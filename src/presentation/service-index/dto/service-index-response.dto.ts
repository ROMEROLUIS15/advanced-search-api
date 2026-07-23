/** Response body for `GET /`: a static description of what this service exposes. */
export interface ServiceIndexResponseDto {
  name: string;
  version: string;
  /** Route (`GET /search`) → one-line description of what it does. */
  endpoints: Record<string, string>;
  docs: string;
}
