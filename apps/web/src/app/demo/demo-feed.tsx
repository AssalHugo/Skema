"use client";
import { VerticalFeed } from "@/components/player/VerticalFeed";
import type { FeedItem } from "@/lib/feed/types";

const noop = () => {};

export function DemoFeed({ items }: { items: FeedItem[] }) {
  return <VerticalFeed items={items} title="La chaîne respiratoire (démo)" exitHref="/" reportProgress={noop} />;
}
