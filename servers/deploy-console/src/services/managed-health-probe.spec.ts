import * as http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { managedHealthCommand, probeManagedHttp } from './managed-health-probe';

describe('target-machine HTTP health probe', () => {
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    server = http.createServer((request, response) => {
      if (request.url === '/stall') return;
      if (request.url === '/redirect') response.setHeader('Location', '/health');
      response.statusCode = request.url === '/redirect' ? 302 : request.url === '/failed' ? 503 : 200;
      response.end('private health body is not returned');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('checks actual HTTP status without returning a health body', async () => {
    await expect(probeManagedHttp(base + '/health')).resolves.toEqual({ ok: true, status: 200 });
    await expect(probeManagedHttp(base + '/failed')).resolves.toEqual({ ok: false, status: 503 });
  });

  it('does not follow a redirect to a different endpoint', async () => {
    await expect(probeManagedHttp(base + '/redirect')).resolves.toEqual({ ok: false, status: 302 });
  });

  it('bounds stalled HTTP requests and returns an explicit failure', async () => {
    await expect(probeManagedHttp(base + '/stall', 30)).resolves.toMatchObject({ ok: false, status: 0, error: expect.stringContaining('timed out') });
  });

  it('runs as a self-contained Node program with shell-safe encoded input', async () => {
    const target = base + "/health?value=';touch /tmp/not-a-health-command";
    const command = managedHealthCommand(target);
    expect(command).not.toContain(target);
    const { stdout } = await promisify(execFile)('bash', ['-c', command], { timeout: 5000 });
    expect(JSON.parse(stdout)).toEqual({ ok: true, status: 200 });
    expect(stdout).not.toContain('private health body');
  });
});
