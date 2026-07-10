import { useState } from "react";
import { Breadcrumb, Container } from "../components/ui";
import { contactAPI } from "../api/contact";

export default function Contact() {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      await contactAPI.send(form);
      setSent(true);
      setForm({ name: "", email: "", phone: "", message: "" });
    } catch {
      setError("Message could not be sent. Please check email settings or call us directly.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Contact" }]} />
      <h1 className="mt-5 font-display text-2xl uppercase tracking-wider text-brand-primary sm:text-3xl">Get In Touch</h1>
      <p className="mt-1 text-xs text-gray-400">We'd love to hear from you.</p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg bg-light-pink p-6 shadow-sm">
          <div className="grid gap-5 sm:grid-cols-2">
            {[
              ["Phone", "+254 720 784379"],
              ["Email", "info@nomanenobazaar.com"],
              ["Location", "Digo Road, Mombasa CBD"],
              ["Hours", "Mon–Sat 9AM–6:30PM"],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">{label}</p>
                <p className="mt-1 text-sm text-charcoal">{val}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-light-pink p-6 shadow-sm">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Contact Form</h2>
          {sent ? (
            <div className="mt-6 rounded-md bg-success/10 p-6 text-center">
              <p className="text-sm font-semibold text-success">✓ Message sent successfully!</p>
              <p className="mt-1 text-xs text-gray-500">We'll be in touch shortly.</p>
            </div>
          ) : (
            <form
              onSubmit={submit}
              className="mt-4 space-y-3"
            >
              {error && <p className="rounded-sm bg-error/10 p-3 text-xs font-semibold text-error">{error}</p>}
              {[
                ["name", "Name", "text"],
                ["email", "Email", "email"],
                ["phone", "Phone (optional)", "tel"],
              ].map(([k, label, type]) => (
                <div key={k}>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">{label}</label>
                  <input
                    required={k !== "phone"}
                    type={type}
                    value={(form as Record<string, string>)[k]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2.5 text-sm outline-none focus:border-brand-secondary"
                  />
                </div>
              ))}
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Message</label>
                <textarea
                  required
                  rows={4}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2.5 text-sm outline-none focus:border-brand-secondary"
                />
              </div>
              <button
                disabled={sending}
                className="rounded-sm bg-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white transition-all hover:bg-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {sending ? "Sending..." : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg">
        <div className="relative flex h-64 items-center justify-center bg-gradient-to-br from-charcoal to-ocean-blue text-white sm:h-80">
          <img
            src="https://images.pexels.com/photos/20177680/pexels-photo-20177680.jpeg?auto=compress&cs=tinysrgb&w=1200"
            alt="Mombasa"
            className="absolute inset-0 h-full w-full object-cover opacity-30"
          />
          <div className="relative text-center">
            <h3 className="font-display text-xl tracking-wider">Find Us on Digo Road</h3>
            <p className="mt-1 text-xs text-white/70">Mombasa CBD, Kenya</p>
            <a
              href="https://maps.app.goo.gl/KZX8BFhd1KTEVrwx5"
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-block rounded-sm bg-brand-secondary px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary transition-all hover:bg-white"
            >
              Open in Google Maps
            </a>
          </div>
        </div>
      </div>
    </Container>
  );
}
