import { useEffect } from 'react';

/**
 * 全局滚动活动监听：滚动发生时给 body 添加 `pf-scrolling` 类，
 * 3 秒无滚动操作后自动移除，配合 index.css 实现细柱滚动条自动渐隐。
 * capture 阶段监听以覆盖所有滚动容器，无逐容器绑定开销。
 */
const SCROLL_IDLE_MS = 3000;

export function useScrollbarAutoHide(): void {
  useEffect(() => {
    let timer: number | undefined;

    const markScrolling = () => {
      document.body.classList.add('pf-scrolling');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        document.body.classList.remove('pf-scrolling');
      }, SCROLL_IDLE_MS);
    };

    const handleScroll = () => {
      markScrolling();
      // 滚动过程中持续刷新活动状态（一次滚动事件序列可能拆分为多帧）
      window.requestAnimationFrame(markScrolling);
    };

    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
      window.clearTimeout(timer);
      document.body.classList.remove('pf-scrolling');
    };
  }, []);
}
