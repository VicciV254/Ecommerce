import { useState, type FormEvent } from "react";
import { adminAPI } from "../../api/admin";
import { describeApiError } from "../../api/errors";
import { saveAdminSession, type AdminSession } from "../../api/staffSession";
import { AuthLayout, authStyles } from "../../components/AuthLayout";
import { PasswordInput } from "../../components/PasswordInput";

export function AdminLogin({ onLogin }: { onLogin: (admin: AdminSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await adminAPI.login({ email, password });
      saveAdminSession(data.admin, data.token, data.refreshToken);
      onLogin(data.admin);
    } catch (err) {
      setError(describeApiError(err, "Invalid admin email or password."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-surface-page">
      <AuthLayout title="Staff sign-in" intro="Staff credentials are required for dashboard access.">
        <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <p role="alert" className={`${authStyles.error} text-center font-semibold`}>{error}</p>}
          <div>
            <label htmlFor="admin-email" className={authStyles.label}>Email</label>
            <input id="admin-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={authStyles.field} />
          </div>
          <div>
            <label htmlFor="admin-password" className={authStyles.label}>Password</label>
            <PasswordInput id="admin-password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={authStyles.field} />
          </div>
          <button disabled={loading} className={authStyles.submit}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </AuthLayout>
    </div>
  );
}
