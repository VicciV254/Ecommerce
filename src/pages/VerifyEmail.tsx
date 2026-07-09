import { FormEvent, useEffect, useRef, useState } from "react";
import { authAPI } from "../api/auth";
import { Link, navigate, parseRoute, useRoute } from "../router";

export default function VerifyEmail() {
  const route = useRoute();
  const { params } = parseRoute(route);
  const initialEmail = params.get("email") ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("Enter the 6-digit OTP sent to your email.");
  const [error, setError] = useState("");
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, 1);
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < 5) inputs.current[index + 1]?.focus();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const next = ["", "", "", "", "", ""];
    pasted.split("").forEach((char, index) => {
      next[index] = char;
    });
    setDigits(next);
    inputs.current[Math.min(pasted.length, 6) - 1]?.focus();
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    const code = digits.join("");
    if (!email || code.length !== 6) {
      setError("Enter your email and the complete 6-digit OTP.");
      return;
    }
    setLoading(true);
    try {
      await authAPI.verifyOtp(email, code);
      setMessage("Email verified. You can now sign in.");
      window.setTimeout(() => navigate(`/login?verified=1&email=${encodeURIComponent(email)}`), 800);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not verify that OTP.");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    setResending(true);
    setError("");
    try {
      const { data } = await authAPI.resendVerification(email);
      if (data?.verificationEmailSent === false) throw new Error("Email not sent");
      setDigits(["", "", "", "", "", ""]);
      setMessage("A fresh OTP has been sent. The previous code is now void.");
      inputs.current[0]?.focus();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Could not resend OTP.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-light-pink px-4">
      <div className="w-full max-w-md rounded-lg border border-brand-secondary/30 bg-off-white p-8 text-center shadow-lg">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-secondary/20 text-xs font-bold text-brand-primary">
          OTP
        </div>
        <h1 className="mt-5 font-display text-2xl text-brand-primary">Verify Your Email</h1>
        <p className="mt-2 text-sm text-charcoal/70">{message}</p>
        {error && <p className="mt-3 rounded-md bg-error/10 p-3 text-sm text-error">{error}</p>}

        <form onSubmit={verify} className="mt-6">
          <label className="block text-left text-xs font-bold uppercase tracking-wider text-brand-primary">Email address</label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="mt-2 w-full rounded-md border border-light-gray bg-white px-3 py-2 text-sm outline-none focus:border-brand-secondary"
          />

          <div className="mt-5 flex justify-center gap-2">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(node) => { inputs.current[index] = node; }}
                value={digit}
                onChange={(event) => setDigit(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
                }}
                onPaste={handlePaste}
                inputMode="numeric"
                maxLength={1}
                className="h-12 w-11 rounded-md border border-light-gray bg-white text-center text-xl font-bold text-brand-primary outline-none focus:border-brand-secondary"
              />
            ))}
          </div>

          <button
            disabled={loading}
            className="mt-6 w-full rounded-sm bg-brand-primary px-4 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>

        <button
          type="button"
          onClick={resend}
          disabled={resending}
          className="mt-4 text-xs font-bold uppercase tracking-wider text-brand-primary underline underline-offset-4 disabled:opacity-50"
        >
          {resending ? "Sending..." : "Resend OTP"}
        </button>

        <div className="mt-5">
          <Link to="/login" className="text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-brand-primary">
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
