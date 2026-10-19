export interface HttpHealthResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function probeManagedHttp(target: string, timeoutMs = 3000): Promise<HttpHealthResult> {
  const address = new URL(target);
  if (!['http:', 'https:'].includes(address.protocol)) throw new Error('Unsupported health protocol');
  const transport = require(address.protocol === 'https:' ? 'node:https' : 'node:http');
  return new Promise(resolve => {
    let settled = false;
    const complete = (result: HttpHealthResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => request.destroy(new Error('Health HTTP request timed out')), timeoutMs);
    const request = transport.get(address, (response: import('node:http').IncomingMessage) => {
      response.resume();
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        complete({ ok: status >= 200 && status < 300, status });
      });
      response.on('error', (error: Error) => complete({ ok: false, status: 0, error: error.message }));
    });
    request.on('error', (error: Error) => complete({ ok: false, status: 0, error: error.message }));
  });
}

export function managedHealthCommand(target: string): string {
  const encoded = Buffer.from(JSON.stringify(target)).toString('base64');
  return "node <<'CONSOLE_MANAGED_HEALTH'\n(" + probeManagedHttp.toString() +
    ")(JSON.parse(Buffer.from('" + encoded + "','base64').toString('utf8'))).then(result=>process.stdout.write(JSON.stringify(result)+'\\n')).catch(error=>{console.error(error.message);process.exitCode=1;});\nCONSOLE_MANAGED_HEALTH";
}
