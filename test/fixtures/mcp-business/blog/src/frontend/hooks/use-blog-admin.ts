import { useEffect, useRef, useState } from "react";
import { isVextApiError } from "vextjs/frontend";
import { blogRequest, clearBlogTokenStorage } from "../lib/blog-api.js";
import type { BlogLabels } from "../types/blog.js";
import type {
  BlogPage,
  BlogStats,
  BlogSaved,
  BlogDeleted,
  BlogWriteInput,
} from "../../types/shared/blog.js";

/** Own authorization and async state together so a late response cannot restore data after logout. */
export function useBlogAdmin(labels: BlogLabels) {
  const [token, setToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [posts, setPosts] = useState<BlogPage>({
    items: [],
    total: 0,
    totalPages: 0,
    page: 1,
    limit: 12,
  });
  const [stats, setStats] = useState<BlogStats>({
    total: 0,
    featured: 0,
    tags: [],
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const logout = () => {
    generation.current += 1;
    busy.current = false;
    setPending(false);
    setToken("");
    setAuthorized(false);
    setPosts({ items: [], total: 0, totalPages: 0, page: 1, limit: 12 });
    setStats({ total: 0, featured: 0, tags: [] });
    setMessage("");
    setError("");
    clearBlogTokenStorage();
  };
  const refreshData = async (
    credential: string,
    owner: number,
    page = posts.page,
  ) => {
    const [list, totals] = await Promise.all([
      blogRequest<BlogPage>("GET", `/api/admin/blog?page=${page}`, credential),
      blogRequest<BlogStats>("GET", "/api/admin/blog/stats", credential),
    ]);
    if (generation.current !== owner) return;
    setPosts(list);
    setStats(totals);
    setAuthorized(true);
  };
  const execute = async (operation: (owner: number) => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    const owner = generation.current;
    try {
      await operation(owner);
    } catch (failure) {
      if (owner !== generation.current) return;
      if (isVextApiError(failure) && failure.status === 401) {
        logout();
        setError(labels.unauthorized);
      } else setError(labels.failed);
    } finally {
      if (owner === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  };
  const refreshAfterCommit = async (owner: number) => {
    try {
      await refreshData(token, owner);
    } catch (failure) {
      if (owner !== generation.current) return;
      if (isVextApiError(failure) && failure.status === 401) {
        logout();
        setError(labels.unauthorized);
      } else setError(labels.refreshFailed);
    }
  };
  return {
    token,
    setToken,
    authorized,
    posts,
    stats,
    pending,
    message,
    error,
    logout,
    login: () => execute((owner) => refreshData(token, owner, 1)),
    refresh: (page = posts.page) =>
      execute((owner) => refreshData(token, owner, page)),
    save: (body: BlogWriteInput, slug?: string, onCommitted?: () => void) =>
      execute(async (owner) => {
        const saved = await blogRequest<BlogSaved>(
          slug ? "PATCH" : "POST",
          slug
            ? `/api/admin/blog/${encodeURIComponent(slug)}`
            : "/api/admin/blog",
          token,
          body,
        );
        if (owner !== generation.current) return;
        setMessage(
          saved.cacheRefresh === "pending" ? labels.cachePending : labels.saved,
        );
        onCommitted?.();
        await refreshAfterCommit(owner);
      }),
    remove: (slug: string) =>
      execute(async (owner) => {
        const result = await blogRequest<BlogDeleted>(
          "DELETE",
          `/api/admin/blog/${encodeURIComponent(slug)}`,
          token,
        );
        if (owner !== generation.current) return;
        setMessage(
          result.cacheRefresh === "pending"
            ? labels.cachePending
            : labels.deleted,
        );
        await refreshAfterCommit(owner);
      }),
    purge: () =>
      execute(async (owner) => {
        await blogRequest("POST", "/api/admin/blog/purge", token);
        if (owner !== generation.current) return;
        setMessage(labels.saved);
        await refreshAfterCommit(owner);
      }),
  };
}
