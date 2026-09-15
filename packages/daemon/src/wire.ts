import { randomBytes } from 'node:crypto';
import type { Config, Secrets } from './config.js';
import type { SessionEnricher, SessionSource } from './sources/types.js';
import type { Transport } from './notify/transport.js';
import { LocalCliSource } from './sources/localCli.js';
import { LocalFilesEnricher } from './sources/localFiles.js';
import { CloudSource } from './sources/cloud.js';
import { ExpoTransport } from './notify/expo.js';
import { MacosTransport } from './notify/macos.js';
import { NtfyTransport } from './notify/ntfy.js';
import type { DaemonState } from './core/state.js';
import { log } from './logger.js';

export function buildSources(config: Config): SessionSource[] {
  const sources: SessionSource[] = [];
  if (config.sources.localCli) sources.push(new LocalCliSource({ redactPaths: config.redactPaths }));
  if (config.sources.cloud.enabled) sources.push(new CloudSource());
  return sources;
}

export function buildEnrichers(config: Config): SessionEnricher[] {
  return config.sources.localFiles ? [new LocalFilesEnricher()] : [];
}

export function buildTransports(config: Config, secrets: Secrets): Transport[] {
  const transports: Transport[] = [];

  if (config.transports.expo.enabled) transports.push(new ExpoTransport());

  if (config.transports.macos.enabled) {
    transports.push(new MacosTransport({ activateBundleId: config.transports.macos.activateBundleId }));
  }

  if (config.transports.ntfy.enabled) {
    const topic = config.transports.ntfy.topic;
    if (!topic) {
      log.warn('ntfy transport is enabled but no topic is set - skipping it. Run `cli init` to generate one.');
    } else {
      transports.push(
        new NtfyTransport({ server: config.transports.ntfy.server, topic, token: secrets.ntfyToken }),
      );
    }
  }

  return transports;
}

/**
 * Resolves the bearer token for the HTTP API, preferring the environment.
 *
 * Generating and persisting one on first run keeps the endpoint closed by
 * default without forcing you to invent a secret before anything works.
 */
export function resolveAuthToken(state: DaemonState, secrets: Secrets): { token: string; generated: boolean } {
  if (secrets.authToken) return { token: secrets.authToken, generated: false };
  if (state.authToken) return { token: state.authToken, generated: false };

  const token = randomBytes(24).toString('base64url');
  state.authToken = token;
  return { token, generated: true };
}
