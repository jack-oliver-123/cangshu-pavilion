import { BookOpen, KeyRound, LoaderCircle, LogIn } from "lucide-react";
import { useState } from "react";

export function LoginView(props: { checking?: boolean; onLogin(password: string): Promise<void> }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  if (props.checking) {
    return (
      <main className="auth-shell" aria-busy="true">
        <div className="auth-brand">
          <span className="brand-mark">
            <BookOpen size={21} />
          </span>
          <h1>藏书阁</h1>
        </div>
        <LoaderCircle className="spin auth-spinner" size={22} />
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="login-panel" aria-labelledby="login-heading">
        <div className="auth-brand">
          <span className="brand-mark">
            <BookOpen size={21} />
          </span>
          <h1 id="login-heading">藏书阁</h1>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!password || submitting) return;
            setSubmitting(true);
            setError(undefined);
            void props
              .onLogin(password)
              .catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : "登录失败。");
              })
              .finally(() => setSubmitting(false));
          }}
        >
          <label htmlFor="shared-password">
            <KeyRound size={15} />
            共享密码
          </label>
          <input
            id="shared-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={!password || submitting}>
            {submitting ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}
            登录
          </button>
        </form>
      </section>
    </main>
  );
}
