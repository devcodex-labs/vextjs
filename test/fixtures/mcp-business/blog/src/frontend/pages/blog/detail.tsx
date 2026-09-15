import { Link, useVextI18n } from "vextjs/frontend";
import type { BlogDetailProps, BlogMessages } from "../../types/blog.js";

export default function BlogDetail({ post, related, locale }: BlogDetailProps) {
  const labels = useVextI18n<BlogMessages>().blog.admin;
  return (
    <main>
      <Link href={`/?lang=${locale}`}>{labels.back}</Link>
      <article>
        <h1>{post.title}</h1>
        <p>{post.excerpt}</p>
        <div style={{ whiteSpace: "pre-wrap" }}>{post.content}</div>
      </article>
      <h2>{labels.related}</h2>
      <ul>
        {related.map((item) => (
          <li key={item.slug}>
            <Link href={`/posts/${item.slug}?lang=${locale}`}>
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
