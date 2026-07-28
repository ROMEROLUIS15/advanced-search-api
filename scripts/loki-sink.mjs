// A throwaway stand-in for Loki, so CI can boot the API with log shipping
// actually configured.
//
// Why this exists: every suite and every CI job ran with LOKI_URL unset, so the
// pino transport worker was never started outside production — and the first
// time it ran there, two wire-format defects took stdout and Loki down together
// without raising anything (fixed in 7ee3757). A real backend is not needed to
// catch that; a socket that records what arrives is.
//
// Usage: node scripts/loki-sink.mjs <output-file> [port]
// Accepts any path, appends each request body as one line, answers 204.

import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const outputFile = process.argv[2] ?? 'loki-received.jsonl';
const port = Number(process.argv[3] ?? 3100);

// Truncate on start so a stale file from an earlier run cannot pass the check.
writeFileSync(outputFile, '');

createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    if (body.length > 0) {
      appendFileSync(outputFile, `${body}\n`);
    }
    response.writeHead(204);
    response.end();
  });
}).listen(port, () => {
  console.log(`loki-sink listening on ${port}, writing to ${outputFile}`);
});
