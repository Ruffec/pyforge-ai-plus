/**
 * 统一数据层测试（无 mock 业务数据）：
 * - isTauri 环境检测
 * - 网页模式 invokeCommand → HTTP 桥接 RPC（成功 / 后端错误 / 网络不可达）
 * - 网页模式 subscribeEvent → 共享 EventSource（SSE）分发与退订
 * - getBridgeBase 端口覆盖与 upgradePip 命令封装
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  CHANNELS,
  getBridgeBase,
  getBridgeStatus,
  invokeCommand,
  isTauri,
  pingBridge,
  subscribeEvent,
  upgradePip,
} from './tauri-api';

/** jsdom 无 EventSource 实现，这里提供最小假实现用于 SSE 通道测试 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(channel: string, payload: unknown) {
    this.onmessage?.({ data: JSON.stringify({ channel, payload }) });
  }
}

const fetchMock = vi.fn();

describe('isTauri', () => {
  afterEach(() => {
    delete window.__TAURI__;
    delete window.__TAURI_INTERNALS__;
  });

  it('returns false when Tauri globals are absent', () => {
    expect(isTauri()).toBe(false);
  });

  it('returns true when __TAURI__ is present', () => {
    window.__TAURI__ = {};
    expect(isTauri()).toBe(true);
  });

  it('returns true when __TAURI_INTERNALS__ is present', () => {
    window.__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });
});

describe('invokeCommand（网页模式 → HTTP 桥接 RPC）', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    FakeEventSource.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('成功响应：POST /api/rpc 并返回 data 字段', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { hello: 'world' } }), { status: 200 })
    );

    const result = await invokeCommand<{ hello: string }>('greet', { name: 'pyforge' });

    expect(result).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:21880/api/rpc');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      command: 'greet',
      args: { name: 'pyforge' },
    });
    expect(getBridgeStatus()).toBe('connected');
  });

  it('后端业务错误：抛出携带 message/code 的 ApiError', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'PythonNotFound', message: '未找到 Python', status_code: 404 },
        }),
        { status: 404 }
      )
    );

    await expect(invokeCommand('scan_python_versions_command')).rejects.toMatchObject({
      name: 'ApiError',
      message: '未找到 Python',
      code: 'PythonNotFound',
      statusCode: 404,
    });
    // 业务错误时桥接服务本身可达，连接状态不受影响
    expect(getBridgeStatus()).toBe('connected');
  });

  it('网络不可达：抛出明确的连接失败提示', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(invokeCommand('list_venvs')).rejects.toThrow(ApiError);
    await expect(invokeCommand('list_venvs')).rejects.toThrow(/无法连接 PyForge 桌面服务/);
  });

  it('upgradePip 走真实后端命令 upgrade_pip_command', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: 'Successfully installed pip-25.0' }), {
        status: 200,
      })
    );

    const output = await upgradePip('C:/Python312/python.exe');

    expect(output).toBe('Successfully installed pip-25.0');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      command: 'upgrade_pip_command',
      args: { pythonPath: 'C:/Python312/python.exe' },
    });
  });

  it('getBridgeBase 支持 ?bridge= 端口覆盖', () => {
    window.history.replaceState({}, '', '/?bridge=3000');
    expect(getBridgeBase()).toBe('http://127.0.0.1:3000');
  });

  it('pingBridge 依据 /api/health 更新连接状态', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(pingBridge()).resolves.toBe(true);
    expect(getBridgeStatus()).toBe('connected');

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(pingBridge()).resolves.toBe(false);
    expect(getBridgeStatus()).toBe('disconnected');
  });
});

describe('subscribeEvent（网页模式 → SSE）', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    FakeEventSource.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('多订阅者共享一条 EventSource，按通道分发 payload', async () => {
    const mirrorHandler = vi.fn();
    const otherHandler = vi.fn();

    const offMirror = await subscribeEvent<{ url: string }>(
      CHANNELS.mirrorChanged,
      mirrorHandler
    );
    const offOther = await subscribeEvent(CHANNELS.configChanged, otherHandler);

    // 两条订阅共享同一个 EventSource 连接
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe('http://127.0.0.1:21880/api/events');

    es.emit(CHANNELS.mirrorChanged, { url: 'https://pypi.org/simple' });
    expect(mirrorHandler).toHaveBeenCalledWith({ url: 'https://pypi.org/simple' });
    expect(otherHandler).not.toHaveBeenCalled();

    es.emit(CHANNELS.configChanged, { key: 'general' });
    expect(otherHandler).toHaveBeenCalledWith({ key: 'general' });

    offMirror();
    es.emit(CHANNELS.mirrorChanged, { url: 'ignored' });
    expect(mirrorHandler).toHaveBeenCalledTimes(1);

    offOther();
    // 最后一个订阅者退订后关闭共享连接
    expect(es.closed).toBe(true);
  });

  it('非 JSON 消息（心跳等）不会导致分发崩溃', async () => {
    const handler = vi.fn();
    const off = await subscribeEvent(CHANNELS.packageChanged, handler);
    const es = FakeEventSource.instances[0];

    expect(() => es.onmessage?.({ data: ': keep-alive' })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});
