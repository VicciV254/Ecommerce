import { FormEvent, useEffect, useRef, useState } from "react";
import { authAPI } from "../api/auth";
import { describeApiError } from "../api/errors";
import { Link, navigate, parseRoute, useRoute } from "../router";
import { AuthLayout, authStyles } from "../components/AuthLayout";
import { loginRoute, safeReturnTo, verifiedSignInRoute } from "../store/returnTo";

/** The verification API's messages say "OTP" ("Invalid OTP. 4 attempt(s) remaining."); shoppers read "code". */
function plainCodeWording(text: string) {
  return text.replace(/\bOTP(?: code)?\b/g, (_match, offset: number) =>
    (offset === 0 || /[.!?]\s+$/.test(text.slice(0, offset)) ? "Code" : "code"));
}

export default function VerifyEmail() {
  const route = useRoute();
  const { params } = parseRoute(route);
  const initialEmail = params.get("email") ?? "";
  // Checked again here: only a safe internal route is passed on to sign-in.
  const returnTo = safeReturnTo(params.get("returnTo"));
  const [email, setEmail] = useState(initialEmail);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("We emailed you a 6-digit code. Enter it below to verify your email.");
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
      setError("Enter your email and the complete 6-digit code.");
      return;
    }
    setLoading(true);
    try {
      await authAPI.verifyOtp(email, code);
      // Sign-in confirms the verification and returns to where the shopper was going; Back skips this page.
      navigate(verifiedSignInRoute(email, returnTo), { replace: true });
    } catch (err) {
      setError(plainCodeWording(describeApiError(err, "Could not verify that code.")));
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
      setMessage("A new code has been sent. The previous code no longer works.");
      inputs.current[0]?.focus();
    } catch (err) {
      setError(plainCodeWording(describeApiError(err, "Could not send a new code.")));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout title="Verify your email" intro={<p role="status">{message}</p>}>
      {error && <p role="alert" className={`mt-4 text-center ${authStyles.error}`}>{error}</p>}

      <form onSubmit={verify} className="mt-6">
        <label htmlFor="verify-email" className={authStyles.label}>Email address</label>
        <input
          id="verify-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={authStyles.field}
        />

        <fieldset className="mt-5">
          <legend className={authStyles.label}>6-digit code</legend>
          <div className="flex justify-center gap-2">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(node) => { inputs.current[index] = node; }}
                aria-label={`Digit ${index + 1} of ${digits.length}`}
                autoComplete={index === 0 ? "one-time-code" : "off"}
                value={digit}
                onChange={(event) => setDigit(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
                }}
                onPaste={handlePaste}
                inputMode="numeric"
                maxLength={1}
                className="h-[48px] w-full min-w-0 max-w-[44px] rounded-sm border border-control bg-surface text-center text-xl font-bold text-navy-900"
              />
            ))}
          </div>
        </fieldset>

        <button disabled={loading} className={`mt-6 ${authStyles.submit}`}>
          {loading ? "Verifying..." : "Verify code"}
        </button>
      </form>

      <div className="mt-4 flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={resend}
          disabled={resending}
          className="inline-flex min-h-[44px] items-center text-sm font-bold uppercase tracking-wider text-navy-900 underline underline-offset-4 disabled:cursor-not-allowed"
        >
          {resending ? "Sending..." : "Send a new code"}
        </button>
        <Link to={loginRoute(returnTo)} className={`inline-flex min-h-[44px] items-center text-sm ${authStyles.link}`}>
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
