import { useEffect, useEffectEvent, useRef, useState } from "react";
import { adminAPI, type PromotionalSendResult, type Subscription } from "../../api/admin";
import { describeApiError } from "../../api/errors";
import { Feedback, TableRegion, WrappingSelect } from "./shared";
import { useUnsavedChanges } from "./unsavedChanges";

/** The same inline padding on every cell, so neighbouring headings and values never run together. */
const headCell = "px-3 py-2";
const bodyCell = "px-3 py-2";
/** A row action keeps its short name inside a 44px target. */
const rowAction = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm px-[8px] text-error hover:underline";

type SendOutcome = { kind: "sent" | "partial" | "failed"; text: string };
const subscribers = (count: number) => `${count} subscriber${count === 1 ? "" : "s"}`;

/**
 * What a send achieved, from the server's tally. Nothing sent is a failure that keeps the draft; a partial send is a
 * warning (the draft is cleared, so sending again cannot reach the same people twice).
 */
function describeSendOutcome({ successful, failed, results }: PromotionalSendResult): SendOutcome {
  if (!Number.isInteger(successful) || !Number.isInteger(failed)) {
    return { kind: "failed", text: "The server's answer could not be read, so it is unclear what was sent. Check before sending again. Your draft is kept." };
  }
  if (successful > 0 && failed === 0) return { kind: "sent", text: `Email sent to ${subscribers(successful)}` };
  if (successful > 0) return { kind: "partial", text: `Sent to ${successful} of ${subscribers(successful + failed)}. ${failed} could not be sent.` };
  const notConfigured = Boolean(results?.length) && results!.every((result) => !result.success && result.code === "MAIL_NOT_CONFIGURED");
  if (notConfigured) return { kind: "failed", text: "No emails were sent. Email delivery isn't set up on the server yet. Your draft is kept." };
  return { kind: "failed", text: `No emails were sent. ${failed} could not be sent. Your draft is kept; try again later.` };
}

/** Server reasons may arrive without a full stop; one is added before another sentence follows. */
const asSentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

export function PromotionsManager({ showToast }: { showToast: (message: string) => void }) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  useUnsavedChanges(Boolean(subject.trim() || content.trim()), "Email promotion");

  const handleEditorInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  };

  const insertHTML = (html: string) => {
    setContent(prev => prev + html);
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  const loadSubscriptions = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await adminAPI.subscriptions.getAll({ active: activeFilter || undefined });
      setSubscriptions(data.subscriptions);
    } catch (err) {
      const message = describeApiError(err, "Could not load subscriptions.");
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  };

  // A filter change reloads the list; the event always uses the latest loader.
  const reloadForFilter = useEffectEvent(() => { void loadSubscriptions(); });
  useEffect(() => {
    reloadForFilter();
  }, [activeFilter]);

  const sendPromotionalEmail = async () => {
    if (!subject || !content) return showToast("Subject and content are required");
    setSending(true);
    setOutcome(null);
    try {
      const { data } = await adminAPI.subscriptions.sendPromotional({ subject, content });
      const result = describeSendOutcome(data);
      if (result.kind === "failed") {
        setOutcome({ tone: "error", text: result.text });
        return;
      }
      if (result.kind === "sent") showToast(result.text);
      else setOutcome({ tone: "warning", text: result.text });
      setSubject("");
      setContent("");
    } catch (error) {
      setOutcome({ tone: "error", text: `${asSentence(describeApiError(error, "Could not send promotional email."))} Your draft is kept.` });
    } finally {
      setSending(false);
    }
  };

  const deleteSubscription = async (id: string) => {
    try {
      await adminAPI.subscriptions.delete(id);
      showToast("Subscription deleted");
      loadSubscriptions();
    } catch (error) {
      showToast(describeApiError(error, "Could not delete subscription."));
    }
  };

  return <div className="space-y-4">
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-brand-primary">Promotions & subscriptions</h3>
          <p className="mt-1 text-xs text-gray-500">Manage email subscriptions and send promotional emails to subscribers.</p>
          <p className="mt-1 text-[0.6875rem] font-bold uppercase tracking-wider text-brand-accent">Showing {subscriptions.length} subscription(s)</p>
        </div>
        <button type="button" onClick={loadSubscriptions} className="min-h-[44px] min-w-[44px] rounded-sm border border-brand-primary px-[14px] py-2 text-[0.6875rem] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">Refresh</button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <WrappingSelect aria-label="Filter subscriptions" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
          <option value="">All subscriptions</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </WrappingSelect>
      </div>
    </div>

    {error && <div className="rounded-lg bg-error/10 p-4 text-sm font-semibold text-error shadow-sm">{error}</div>}
    {loading && <div className="rounded-lg bg-white p-6 text-sm text-gray-500 shadow-sm">Loading subscriptions...</div>}

    <div className="rounded-lg bg-white p-5 shadow-sm">
      <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-brand-primary mb-4">Send promotional email</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-[0.625rem] font-bold uppercase tracking-wider text-gray-400 mb-1">Subject</label>
          <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject line" className="w-full rounded-sm border border-light-gray px-3 py-2 text-xs" />
        </div>
        <div>
          <label className="block text-[0.625rem] font-bold uppercase tracking-wider text-gray-400 mb-1">Content (HTML supported)</label>
          <div className="rounded-sm border border-light-gray">
            <div className="flex flex-wrap items-center gap-1 border-b border-light-gray bg-off-white p-2">
              <button onClick={() => insertHTML('<strong>')} className="rounded px-2 py-1 text-xs font-bold hover:bg-gray-200" title="Bold">B</button>
              <button onClick={() => insertHTML('<em>')} className="rounded px-2 py-1 text-xs italic hover:bg-gray-200" title="Italic">I</button>
              <button onClick={() => insertHTML('<u>')} className="rounded px-2 py-1 text-xs underline hover:bg-gray-200" title="Underline">U</button>
              <div className="w-px h-5 bg-gray-300 mx-1"></div>
              <button onClick={() => insertHTML('<ul><li>')} className="rounded px-2 py-1 text-xs hover:bg-gray-200" title="Bullet list">•</button>
              <button onClick={() => insertHTML('<ol><li>')} className="rounded px-2 py-1 text-xs hover:bg-gray-200" title="Numbered list">1.</button>
              <div className="w-px h-5 bg-gray-300 mx-1"></div>
              <button onClick={() => {
                const url = prompt('Enter link URL:');
                if (url) insertHTML(`<a href="${url}">`);
              }} className="rounded px-2 py-1 text-xs hover:bg-gray-200" title="Insert link">🔗</button>
            </div>
            <textarea
              ref={editorRef}
              aria-label="Content (HTML supported)"
              value={content}
              onChange={handleEditorInput}
              placeholder="Email content... (HTML supported)"
              rows={6}
              className="w-full p-3 text-xs outline-none resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={sendPromotionalEmail} disabled={sending || subscriptions.length === 0} className="min-h-[44px] rounded-sm bg-brand-primary px-[16px] py-2 text-[0.6875rem] font-bold uppercase text-white hover:bg-brand-secondary hover:text-brand-primary disabled:opacity-50">
            {sending ? "Sending..." : `Send to ${subscriptions.length} subscribers`}
          </button>
        </div>
        {outcome && <Feedback message={outcome.text} tone={outcome.tone} />}
      </div>
    </div>

    {!loading && (
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-brand-primary mb-4">Subscriptions</h3>
        {subscriptions.length === 0 ? (
          <p className="text-sm text-gray-500">No subscriptions found.</p>
        ) : (
          <TableRegion label="Subscriptions table" className="-my-[6px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-light-gray text-left text-[0.625rem] font-bold uppercase tracking-wider text-muted">
                  <th className={headCell}>Email</th>
                  <th className={headCell}>Status</th>
                  <th className={headCell}>Subscribed</th>
                  <th className={headCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="border-b border-light-gray">
                    <td className={bodyCell}>{sub.email}</td>
                    <td className={bodyCell}>
                      <span className={`rounded-full px-2 py-1 text-xs ${sub.isActive ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
                        {sub.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className={bodyCell}>{new Date(sub.createdAt).toLocaleDateString()}</td>
                    <td className={bodyCell}>
                      <button onClick={() => deleteSubscription(sub.id)} className={rowAction}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </div>
    )}
  </div>;
}
