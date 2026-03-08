import type { JSDocTag } from "ts-morph";

export function getTagText(tag: JSDocTag): string {
    const raw = tag.getComment();
    return (typeof raw === "string" ? raw : tag.getCommentText() ?? "").trim();
}
