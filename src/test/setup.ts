import '@testing-library/jest-dom/vitest';

/**
 * jsdom 未实现 EventSource。
 * 统一数据层（tauri-api.ts）在网页模式下通过共享 EventSource 订阅 SSE，
 * 页面组件挂载即订阅跨端同步事件，这里提供最小桩实现避免未定义错误。
 */
class EventSourceStub {
  static instances: EventSourceStub[] = [];
  url: string;
  readyState = 0;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    EventSourceStub.instances.push(this);
  }

  close() {
    this.readyState = 2;
  }
}

if (typeof globalThis.EventSource === 'undefined') {
  // 直接挂载 globalThis（不经过 vi.stubGlobal，避免被测试文件的
  // unstubAllGlobals 一并清除）
  (globalThis as unknown as { EventSource: unknown }).EventSource = EventSourceStub;
}
