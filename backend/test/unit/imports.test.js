import assert from 'node:assert/strict';
import { Server } from 'node:net';
import { test } from 'node:test';
import axios from 'axios';
import prisma from '../../src/config/database.js';

test('importing the app and server does not listen, connect, authenticate an image host, or install shutdown handlers', async (t) => {
  const listen = t.mock.method(Server.prototype, 'listen', () => { throw new Error('Unexpected listen'); });
  const connect = t.mock.method(prisma, '$connect', async () => { throw new Error('Unexpected connection'); });
  const post = t.mock.method(axios, 'post', async () => { throw new Error('Unexpected network call'); });
  const signals = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  process.env.IMAGE_HOST_API_URL = 'http://127.0.0.1:1';
  process.env.IMAGE_HOST_LOGIN_URL = 'http://127.0.0.1:1/login';
  process.env.IMAGE_HOST_USERNAME = 'test-user';
  process.env.IMAGE_HOST_PASSWORD = 'test-only-password';
  process.env.IMAGE_HOST_SESSION_REFRESH = '0';
  t.after(() => {
    process.env.IMAGE_HOST_API_URL = '';
    process.env.IMAGE_HOST_LOGIN_URL = '';
    process.env.IMAGE_HOST_USERNAME = '';
    process.env.IMAGE_HOST_PASSWORD = '';
  });

  const { default: app } = await import('../../src/app.js');
  const { startServer } = await import('../../src/server.js');
  assert.equal(typeof app, 'function');
  assert.equal(typeof startServer, 'function');
  assert.equal(listen.mock.callCount(), 0);
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(post.mock.callCount(), 0);
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], signals);
});

test('missing server configuration fails before a database connection is attempted', async (t) => {
  const { startServer } = await import('../../src/server.js');
  const connect = t.mock.method(prisma, '$connect', async () => { throw new Error('Unexpected connection'); });
  const secret = process.env.JWT_SECRET;
  t.after(() => { process.env.JWT_SECRET = secret; });
  process.env.JWT_SECRET = '';
  await assert.rejects(startServer({ port: 0, host: '127.0.0.1' }), /JWT_SECRET must be configured/);
  assert.equal(connect.mock.callCount(), 0);
});
