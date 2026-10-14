import { ChevronLeft, ChevronRight } from 'lucide-react';
import React from 'react';
import { Button } from '@/components/ui/Button';
import { Select, SelectItem } from '@/components/ui/Select';

/** 默认每页条数可选项 */
export const PAGE_SIZE_OPTIONS = [10, 20, 30, 50] as const;

export interface PaginationProps {
  /** 当前页码（1 起） */
  page: number;
  /** 每页条数 */
  pageSize: number;
  /** 数据总条数 */
  total: number;
  onPageChange: (page: number) => void;
  /** 提供时展示「每页 N 条」选择器 */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}

type PageItem = number | 'ellipsis-left' | 'ellipsis-right';

/** 计算带省略号的页码序列：首尾页 + 当前页 ±1 */
export function getPageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const items: PageItem[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) {
    items.push('ellipsis-left');
  }
  for (let i = start; i <= end; i += 1) {
    items.push(i);
  }
  if (end < totalPages - 1) {
    items.push('ellipsis-right');
  }
  items.push(totalPages);
  return items;
}

/**
 * 标准分页控件：上一页/页码（含省略号）/下一页 + 总条数 + 每页条数选择器。
 * 与全局设计风格一致，整体居中展示。
 */
export const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className = '',
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const items = getPageItems(safePage, totalPages);

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-2 ${className}`}
      role="navigation"
      aria-label="分页导航"
    >
      {onPageSizeChange && (
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-xs text-pf-muted-foreground">每页</span>
          <Select
            aria-label="每页显示条数"
            value={String(pageSize)}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-7 w-[72px] px-2 py-0 text-xs"
          >
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} 条
              </SelectItem>
            ))}
          </Select>
        </div>
      )}

      <span className="whitespace-nowrap text-xs text-pf-muted-foreground">
        共 {total} 条
      </span>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="上一页"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        {items.map((item) => {
          if (item === 'ellipsis-left' || item === 'ellipsis-right') {
            return (
              <span
                key={item}
                className="flex h-7 min-w-[28px] items-center justify-center text-xs text-pf-muted-foreground"
              >
                …
              </span>
            );
          }
          const active = item === safePage;
          return (
            <Button
              key={item}
              variant={active ? 'default' : 'ghost'}
              size="sm"
              className="h-7 min-w-[28px] px-1.5"
              aria-current={active ? 'page' : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          );
        })}

        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="下一页"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};
