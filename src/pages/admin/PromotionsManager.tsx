import { useEffect, useRef, useState } from "react";
import { adminAPI, type Subscription } from "../../api/admin";
import { describeApiError } from "../../api/errors";
import { TableRegion } from "./shared";
import { useUnsavedChanges } from "./unsavedChanges";

export function PromotionsManager({ showToast }: { showToast: (message: string) => void }) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
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

  useEffect(() => {
    loadSubscriptions();
  }, [activeFilter]);

  const sendPromotionalEmail = async () => {
    if (!subject || !content) return showToast("Subject and content are required");
    setSending(true);
    try {
      const { data } = await adminAPI.subscriptions.sendPromotional({ subject, content });
      showToast(`Email sent to ${data.successful} subscribers (${data.failed} failed)`);
      setSubject("");
      setContent("");
    } catch (error) {
      showToast(describeApiError(error, "Could not send promotional email."));
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
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Promotions & Subscriptions</h3>
          <p className="mt-1 text-xs text-gray-500">Manage email subscriptions and send promotional emails to subscribers.</p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-brand-accent">Showing {subscriptions.length} subscription(s)</p>
        </div>
        <button onClick={loadSubscriptions} className="rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">Refresh</button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <select aria-label="Filter subscriptions" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
          <option value="">All Subscriptions</option>
          <option value="true">Active Only</option>
          <option value="false">Inactive Only</option>
        </select>
      </div>
    </div>

    {error && <div className="rounded-lg bg-error/10 p-4 text-sm font-semibold text-error shadow-sm">{error}</div>}
    {loading && <div className="rounded-lg bg-white p-6 text-sm text-gray-500 shadow-sm">Loading subscriptions...</div>}

    <div className="rounded-lg bg-white p-5 shadow-sm">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary mb-4">Send Promotional Email</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Subject</label>
          <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject line" className="w-full rounded-sm border border-light-gray px-3 py-2 text-xs" />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Content (HTML supported)</label>
          <div className="rounded-sm border border-light-gray">
            <div className="flex flex-wrap items-center gap-1 border-b border-light-gray bg-off-white p-2">
              <button onClick={() => insertHTML('<strong>')} className="rounded px-2 py-1 text-xs font-bold hover:bg-gray-200" title="Bold">B</button>
              <button onClick={() => insertHTML('<em>')} className="rounded px-2 py-1 text-xs italic hover:bg-gray-200" title="Italic">I</button>
              <button onClick={() => insertHTML('<u>')} className="rounded px-2 py-1 text-xs underline hover:bg-gray-200" title="Underline">U</button>
              <div className="w-px h-5 bg-gray-300 mx-1"></div>
              <button onClick={() => insertHTML('<ul><li>')} className="rounded px-2 py-1 text-xs hover:bg-gray-200" title="Bullet List">•</button>
              <button onClick={() => insertHTML('<ol><li>')} className="rounded px-2 py-1 text-xs hover:bg-gray-200" title="Numbered List">1.</button>
              <div className="w-px h-5 bg-gray-300 mx-1"></div>
              <button onClick={() => {
                const url = prompt('Enter link URL:');
                if (url) insertHTML(`<a href="${url}">`);
              }} className="rounded px-2 py-1 text-xs hover:bg-gray-200" title="Insert Link">🔗</button>
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
          <button onClick={sendPromotionalEmail} disabled={sending || subscriptions.length === 0} className="rounded-sm bg-brand-primary px-4 py-2 text-[10px] font-bold uppercase text-white hover:bg-brand-secondary hover:text-brand-primary disabled:opacity-50">
            {sending ? "Sending..." : `Send to ${subscriptions.length} Subscribers`}
          </button>
        </div>
      </div>
    </div>

    {!loading && (
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary mb-4">Subscriptions</h3>
        {subscriptions.length === 0 ? (
          <p className="text-sm text-gray-500">No subscriptions found.</p>
        ) : (
          <TableRegion label="Subscriptions table" className="-my-[6px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  <th className="py-2">Email</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Subscribed</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="border-b border-light-gray">
                    <td className="py-2">{sub.email}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-1 text-xs ${sub.isActive ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
                        {sub.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2">{new Date(sub.createdAt).toLocaleDateString()}</td>
                    <td className="py-2">
                      <button onClick={() => deleteSubscription(sub.id)} className="text-error hover:underline">Delete</button>
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
