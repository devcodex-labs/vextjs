import { useState, type FormEvent } from "react";
import type { useBlogAdmin } from "../hooks/use-blog-admin.js";
import type { BlogLabels } from "../types/blog.js";
import type { BlogWriteInput } from "../../types/shared/blog.js";

const emptyPost: BlogWriteInput = {
  slug: "",
  title: "",
  excerpt: "",
  content: "",
  tags: [],
  status: "draft",
  featured: false,
};

/** This authenticated subtree unmounts on logout or 401, discarding every editing field. */
export default function BlogAdminPanel({
  admin,
  labels,
}: {
  admin: ReturnType<typeof useBlogAdmin>;
  labels: BlogLabels;
}) {
  const [editing, setEditing] = useState<string>();
  const [form, setForm] = useState<BlogWriteInput>(emptyPost);
  const [tags, setTags] = useState("");
  const reset = () => {
    setEditing(undefined);
    setForm(emptyPost);
    setTags("");
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void admin.save(
      {
        ...form,
        slug: form.slug || undefined,
        tags: [
          ...new Set(
            tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ],
      },
      editing,
      reset,
    );
  };
  return (
    <>
      <button
        onClick={() => {
          admin.logout();
          reset();
        }}
      >
        {labels.logout}
      </button>
      <button disabled={admin.pending} onClick={() => void admin.refresh()}>
        {labels.refresh}
      </button>
      <button disabled={admin.pending} onClick={() => void admin.purge()}>
        {labels.purge}
      </button>
      <p>
        {labels.total}: {admin.stats.total}
      </p>
      <ul>
        {admin.posts.items.map((post) => (
          <li key={post.slug}>
            {post.title}{" "}
            <span>
              {post.status === "draft" ? labels.draft : labels.published}
            </span>
            <button
              disabled={admin.pending}
              onClick={() => {
                setEditing(post.slug);
                setForm({
                  slug: post.slug,
                  title: post.title,
                  excerpt: post.excerpt,
                  content: post.content,
                  status: post.status,
                  featured: post.featured,
                  tags: post.tags,
                  publishedAt: post.publishedAt,
                });
                setTags(post.tags.join(", "));
              }}
            >
              {labels.edit}
            </button>
            <button
              disabled={admin.pending}
              onClick={() => void admin.remove(post.slug)}
            >
              {labels.remove}
            </button>
          </li>
        ))}
      </ul>
      <nav>
        {admin.posts.page > 1 && (
          <button
            disabled={admin.pending}
            onClick={() => void admin.refresh(admin.posts.page - 1)}
          >
            {labels.previous}
          </button>
        )}
        {admin.posts.page < admin.posts.totalPages && (
          <button
            disabled={admin.pending}
            onClick={() => void admin.refresh(admin.posts.page + 1)}
          >
            {labels.next}
          </button>
        )}
      </nav>
      <h2>{editing ? labels.edit : labels.newPost}</h2>
      <form onSubmit={save}>
        <fieldset disabled={admin.pending}>
          <label>
            {labels.slug}
            <input
              value={form.slug ?? ""}
              onChange={(event) =>
                setForm({ ...form, slug: event.target.value })
              }
            />
          </label>
          <label>
            {labels.postTitle}
            <input
              required
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </label>
          <label>
            {labels.excerpt}
            <textarea
              required
              value={form.excerpt}
              onChange={(event) =>
                setForm({ ...form, excerpt: event.target.value })
              }
            />
          </label>
          <label>
            {labels.content}
            <textarea
              required
              value={form.content}
              onChange={(event) =>
                setForm({ ...form, content: event.target.value })
              }
            />
          </label>
          <label>
            {labels.tags}
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
          <label>
            {labels.status}
            <select
              value={form.status}
              onChange={(event) =>
                setForm({
                  ...form,
                  status:
                    event.target.value === "published" ? "published" : "draft",
                })
              }
            >
              <option value="draft">{labels.draft}</option>
              <option value="published">{labels.published}</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.featured ?? false}
              onChange={(event) =>
                setForm({ ...form, featured: event.target.checked })
              }
            />
            {labels.featured}
          </label>
          <button>{labels.save}</button>
          <button type="button" onClick={reset}>
            {labels.cancel}
          </button>
        </fieldset>
      </form>
    </>
  );
}
