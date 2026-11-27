// Kiểu DTO bám docs/API.md.
export type ItemType = "tool" | "web" | "doc" | "note" | "link";
export type ItemStatus = "active" | "draft" | "archived";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
  mustChangePassword: boolean;
}

export interface Topic {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
  itemCount: number;
  children: Topic[];
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  count?: number;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  description: string | null;
  url: string | null;
  icon: string | null;
  status: ItemStatus;
  topicId: string | null;
  tags: Tag[];
  pinned: boolean;
  sortOrder: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface FileInfo {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  sha256?: string;
}

export type FileView =
  | { kind: "html"; html: string }
  | { kind: "sheets"; sheets: { name: string; rows: string[][]; truncated: boolean }[] };

export interface NoteData {
  markdown: string;
  version: number;
  updatedAt: string;
}

export interface NoteVersionInfo {
  version: number;
  createdAt: string;
  author: string | null;
  size: number;
}

export interface ItemInput {
  type?: ItemType;
  title?: string;
  description?: string;
  url?: string;
  icon?: string;
  topicId?: string | null;
  tags?: string[];
  status?: ItemStatus;
  pinned?: boolean;
}

export interface ItemQuery {
  topic?: string;
  q?: string;
  tag?: string;
  type?: string;
  status?: ItemStatus;
  pinned?: boolean;
  recent?: boolean;
  limit?: number;
  cursor?: string;
}
