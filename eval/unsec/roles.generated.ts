
export type _TYSAST_GRAPH = {
    "admin": ["user", "unauth"],
  "user": ["unauth"],
  "unauth": []
};

export type _TYSAST_ROLE = keyof _TYSAST_GRAPH;

declare const _TYSAST_BRAND: unique symbol;
type _TO_TYSAST_BRAND<K> = { readonly [_TYSAST_BRAND]: K };
export type _TYSAST_ROLE_TOKEN<R extends _TYSAST_ROLE> = _TO_TYSAST_BRAND<R> & { readonly role: R };
export function _TYSAST_MAKE_ROLE<R extends _TYSAST_ROLE>(r: R): _TYSAST_ROLE_TOKEN<R> { return { role: r } as _TYSAST_ROLE_TOKEN<R>; }

type _TYSAST_REACHABLE_FROM<Target extends _TYSAST_ROLE, Visited extends _TYSAST_ROLE = never> =
  Target extends Visited ? never :
  Target | (_TYSAST_GRAPH[Target] extends readonly (infer Ns)[] 
        ? (Ns extends _TYSAST_ROLE ? _TYSAST_REACHABLE_FROM<Ns, Visited | Target> : never) 
        : never);

export type _TYSAST_CAN_ELEVATE<From extends _TYSAST_ROLE, To extends _TYSAST_ROLE> = To extends _TYSAST_REACHABLE_FROM<From> ? true : false;

export function requireRole<
  From extends _TYSAST_ROLE,
  To extends _TYSAST_REACHABLE_FROM<From>
>(
  current: _TYSAST_ROLE_TOKEN<From>,
  target: To
) {
  return _TYSAST_MAKE_ROLE(target);
}
export const _TYSAST_DEFAULT_ROLE: _TYSAST_ROLE = "unauth";
