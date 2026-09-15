import { networkInterfaces } from 'node:os';

/**
 * Tailscale hands every node an address in the 100.64.0.0/10 carrier-grade NAT
 * range. Reading it from the interface list avoids depending on the `tailscale`
 * CLI being on PATH.
 */
function isTailscaleAddress(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 100 && b >= 64 && b <= 127;
}

export function findTailscaleAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal && isTailscaleAddress(address.address)) {
        return address.address;
      }
    }
  }
  return null;
}

/**
 * Resolves the configured bind target to a concrete address.
 *
 * Never returns 0.0.0.0: the daemon exposes session metadata, and binding to
 * every interface would publish it on whatever café or client network the
 * laptop is on. The mesh address (or loopback) is the whole boundary.
 */
export function resolveBindAddress(bind: string): { address: string; note: string } {
  if (bind === 'loopback') {
    return { address: '127.0.0.1', note: 'loopback only - the phone will not be able to reach this' };
  }

  if (bind === 'tailscale') {
    const address = findTailscaleAddress();
    if (!address) {
      throw new Error(
        'No Tailscale address found (looked for a 100.64.0.0/10 interface). ' +
          'Start Tailscale and sign in, or set server.bind to "loopback" or an explicit IP in the config.',
      );
    }
    return { address, note: 'Tailscale mesh' };
  }

  if (bind === '0.0.0.0' || bind === '::') {
    throw new Error('Refusing to bind every interface - set server.bind to "tailscale", "loopback", or one IP.');
  }

  return { address: bind, note: 'explicit address from config' };
}
