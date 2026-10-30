#!/usr/bin/env node
import path from 'node:path';
import { parseExchangeArgs } from './args.js';
import { runExchangeClient } from './client.js';
import { createExchangeServer } from './server.js';
import { exchangeHelp } from './help.js';
import { renderInbox } from './inbox.js';
import { isExchangeOutput, isInbox } from './output.js';
import { ExchangeError, exact, isKey, requireValue } from './values.js';
import { errorCodes } from './httpIo.js';

try {
  const parsed = parseExchangeArgs(process.argv.slice(2));
  if (parsed.command === 'help') process.stdout.write(exchangeHelp);
  else if (parsed.command === 'serve') {
    requireValue(process.env.ATC_READ_ONLY === undefined || ['0', '1'].includes(process.env.ATC_READ_ONLY));
    const server = createExchangeServer({ folder: path.resolve(parsed.flags.data), repository: parsed.flags.repo,
      origin: parsed.flags.origin, readOnly: process.env.ATC_READ_ONLY === '1' });
    server.on('error', () => { process.stderr.write('atc-exchange: unavailable\n'); server.close(); process.exitCode = 1; });
    server.listen(Number(parsed.flags.port), '127.0.0.1', () => process.stdout.write('{"outcome":"listening"}\n'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  } else {
    const result = await runExchangeClient(parsed);
    requireValue(isExchangeOutput(result) || parsed.command === 'id' && exact(result, { id: isKey }), 'unavailable', 503);
    process.stdout.write(`${parsed.flags.text && isInbox(result) ? renderInbox(result) : JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  const code = error instanceof ExchangeError && [...errorCodes, 'proofUncertain'].includes(error.code) ? error.code : 'unavailable';
  process.stderr.write(`atc-exchange: ${code}\n`);
  process.exitCode = 1;
}
