"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";

type SortableListProps<T> = {
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  onReorder: (ids: string[]) => void;
  disabled?: boolean;
};

export function SortableList<T>({
  items,
  getId,
  getLabel,
  renderItem = getLabel,
  onReorder,
  disabled = false,
}: SortableListProps<T>) {
  const move = (from: number, to: number) => {
    const ids = items.map(getId);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    onReorder(ids);
  };

  return (
    <ol className="divide-y rounded-lg border">
      {items.map((item, index) => {
        const label = getLabel(item);
        return (
          <li key={getId(item)} className="flex items-center gap-2 p-2">
            <div className="min-w-0 flex-1">{renderItem(item)}</div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move '${label}' up`}
              disabled={disabled || index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move '${label}' down`}
              disabled={disabled || index === items.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
