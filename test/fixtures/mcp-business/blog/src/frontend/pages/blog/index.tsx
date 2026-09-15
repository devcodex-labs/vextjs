import { Link, useVextI18n } from "vextjs/frontend";
import BlogCover from "../../components/blog-cover.js";
import type { BlogMessages, BlogPageProps } from "../../types/blog.js";

/** UTC and the explicit locale keep server and browser date output aligned. */
export default function BlogPage({ page, query, locale }: BlogPageProps) {
  const labels = useVextI18n<BlogMessages>().blog.admin;
  const pageUrl = (number: number, tag = query.tag) => {
    const params = new URLSearchParams({ lang: locale, page: String(number) });
    if (tag) params.set("tag", tag);
    if (query.search) params.set("search", query.search);
    return `/?${params}`;
  };
  return (
    <main>
      <h1>{labels.title}</h1>
      <Link href={`/admin?lang=${locale}`}>{labels.admin}</Link>
      <nav>
        <a href="/?lang=en-US">English</a> <a href="/?lang=zh-CN">中文</a>
      </nav>
      <form action="/">
        <input type="hidden" name="lang" value={locale} />
        <label>
          {labels.search}
          <input name="search" defaultValue={query.search ?? ""} />
        </label>
        <button>{labels.filter}</button>
      </form>
      <p>
        {labels.total}: <span data-total>{page.total}</span>
      </p>
      {!page.items.length && <p>{labels.empty}</p>}
      {page.items.map((post) => (
        <article key={post.slug}>
          <BlogCover labels={labels} />
          <h2>
            <Link href={`/posts/${post.slug}?lang=${locale}`}>
              {post.title}
            </Link>
          </h2>
          <p>{post.excerpt}</p>
          {post.publishedAt && (
            <time dateTime={post.publishedAt}>
              {new Date(post.publishedAt).toLocaleDateString(locale, {
                timeZone: "UTC",
              })}
            </time>
          )}
          <ul>
            {post.tags.map((tag) => (
              <li key={tag}>
                <Link href={pageUrl(1, tag)}>{tag}</Link>
              </li>
            ))}
          </ul>
        </article>
      ))}
      <nav aria-label={labels.title}>
        {page.page > 1 && (
          <Link href={pageUrl(page.page - 1)}>{labels.previous}</Link>
        )}
        {page.page < page.totalPages && (
          <Link href={pageUrl(page.page + 1)}>{labels.next}</Link>
        )}
      </nav>
    </main>
  );
}
