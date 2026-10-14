import type { PipMirror } from '@/types/packages';

/**
 * 镜像源注册表与排序规则（模块化、可扩展）：
 * - 国内镜像源：参与延迟测速，按延迟从小到大排序；
 * - 官方镜像源：不参与排序，保持固定展示顺序；
 * - 测速超时阈值 3000ms，超时节点排至国内源列表末尾。
 *
 * 新增镜像源只需在 DOMESTIC_MIRROR_IDS / OFFICIAL_MIRROR_HOSTS 注册，
 * 或使其 URL 命中官方域名模式，即可自动获得一致的排序与测速行为。
 */

/** 镜像源延迟检测超时阈值（ms） */
export const MIRROR_SPEED_TIMEOUT_MS = 3000;

/** 已知国内镜像源 id（与后端 get_default_mirrors 及内置注册表对应） */
const DOMESTIC_MIRROR_IDS = new Set([
  'tsinghua',
  'aliyun',
  'tencent',
  'ustc',
  'douban',
  'bfsu',
  'sjtu',
  'huawei',
  'netease',
]);

/** 官方镜像源域名（命中即视为官方源，不参与国内排序） */
const OFFICIAL_MIRROR_HOSTS = new Set(['pypi.org', 'pypi.python.org']);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 是否为官方镜像源（不参与国内源排序） */
export function isOfficialMirror(mirror: Pick<PipMirror, 'id' | 'url'>): boolean {
  if (mirror.id === 'pypi' || mirror.id === 'official') {
    return true;
  }
  const host = hostOf(mirror.url);
  return OFFICIAL_MIRROR_HOSTS.has(host) || host.endsWith('.pypi.org');
}

/** 是否为国内镜像源（参与延迟排序；注册表命中或非官方的自定义源均视为国内源） */
export function isDomesticMirror(mirror: Pick<PipMirror, 'id' | 'url'>): boolean {
  return DOMESTIC_MIRROR_IDS.has(mirror.id) || !isOfficialMirror(mirror);
}

/** 国内源排序比较：延迟升序，超时（无延迟数据）排末尾 */
function compareDomestic(a: PipMirror, b: PipMirror): number {
  const la = a.latencyMs;
  const lb = b.latencyMs;
  if (la === undefined && lb === undefined) return 0;
  if (la === undefined) return 1;
  if (lb === undefined) return -1;
  return la - lb;
}

/**
 * 统一镜像源排序：
 * 1. 国内镜像源按延迟从小到大，超时节点排末尾；
 * 2. 官方镜像源不参与排序，保持原有固定顺序，置于列表最后。
 */
export function sortMirrors(mirrors: PipMirror[]): PipMirror[] {
  const domestic: PipMirror[] = [];
  const official: PipMirror[] = [];

  mirrors.forEach((mirror) => {
    if (isOfficialMirror(mirror)) {
      official.push(mirror);
    } else {
      domestic.push(mirror);
    }
  });

  domestic.sort(compareDomestic);
  return [...domestic, ...official];
}

/**
 * 单个镜像源延迟检测：超过 MIRROR_SPEED_TIMEOUT_MS 判定超时，返回 undefined。
 * 后端请求继续在后台执行无碍 UI；前端以 race 保证排序流程按时完成。
 */
export async function measureMirrorSpeed(
  mirror: Pick<PipMirror, 'id' | 'url'>,
  testFn: (url: string) => Promise<number>
): Promise<number | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), MIRROR_SPEED_TIMEOUT_MS);
  });

  try {
    const latency = await Promise.race([
      testFn(mirror.url).catch(() => undefined),
      timeout,
    ]);
    return latency;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * 并发检测所有国内镜像源延迟（官方源不测速、不排序）。
 * 返回仅包含国内源延迟结果的 Map，超时节点不出现在结果中（视为 undefined）。
 */
export async function measureDomesticMirrorSpeeds(
  mirrors: PipMirror[],
  testFn: (url: string) => Promise<number>
): Promise<Map<string, number | undefined>> {
  const domesticMirrors = mirrors.filter(isDomesticMirror);
  const entries = await Promise.all(
    domesticMirrors.map(async (mirror) => {
      const latency = await measureMirrorSpeed(mirror, testFn);
      return [mirror.id, latency] as const;
    })
  );
  return new Map(entries);
}
