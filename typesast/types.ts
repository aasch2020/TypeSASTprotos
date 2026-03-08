import type { Node } from "ts-morph";

export type RoleHierarchy = string[];

export interface RaisedEntry {
    node: Node;
    roleName: string;
}
