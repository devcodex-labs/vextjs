import { useVextI18n } from "vextjs/frontend";
import { useBlogAdmin } from "../../hooks/use-blog-admin.js";
import BlogAdminPanel from "../../components/blog-admin-panel.js";
import type { BlogMessages } from "../../types/blog.js";

/** The initial page has no credentials or draft data; authenticated API calls fill the view. */
export default function BlogAdmin() {
  const labels = useVextI18n<BlogMessages>().blog.admin;
  const admin = useBlogAdmin(labels);
  return (
    <main>
      <h1>{labels.admin}</h1>
      {admin.error && <p role="alert">{admin.error}</p>}
      {admin.message && <p role="status">{admin.message}</p>}
      {admin.pending && <p role="status">{labels.pending}</p>}
      {!admin.authorized ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void admin.login();
          }}
        >
          <label>
            {labels.token}
            <input
              type="password"
              autoComplete="off"
              value={admin.token}
              onChange={(event) => admin.setToken(event.target.value)}
            />
          </label>
          <button disabled={admin.pending}>{labels.login}</button>
        </form>
      ) : (
        <BlogAdminPanel admin={admin} labels={labels} />
      )}
    </main>
  );
}
