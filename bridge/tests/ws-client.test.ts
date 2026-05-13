import { it, expect } from 'vitest';
import { createServerWsClient } from '../src/cloud/ws-client.js';

it('exports createServerWsClient function', () => {
  expect(typeof createServerWsClient).toBe('function');
});
