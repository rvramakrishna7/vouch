import { useState, useRef, type FormEvent, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";

const CHANNELS = [
  "Instagram",
  "Facebook",
  "LinkedIn",
  "X",
  "Website",
  "Email",
  "Print",
  "Other",
] as const;

export function NewContentPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState<string>("Instagram");
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [body, setBody] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Guard: creator only
  if (user && user.role !== "creator") {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-800">
        <h2 className="text-base font-semibold">Creator access required</h2>
        <p className="mt-1 text-sm">
          Only Creators can submit new marketing content. Reviewers and Brand Managers can view submitted content in the Review Queue.
        </p>
        <div className="mt-4">
          <Link
            to="/reviews"
            className="text-sm font-semibold text-amber-900 underline hover:text-amber-950"
          >
            Go to Reviews →
          </Link>
        </div>
      </div>
    );
  }

  const handleUseSample = () => {
    setTitle("Instagram caption: Flow launch");
    setChannel("Instagram");
    setAudience("Urban buyers aged 22 to 35");
    setPurpose("Highlight sustainability and lightness of the new bottle");
    setBody(
      "India's No.1 eco-friendly water bottle, now 40% lighter. Rated 4.8 by our customers! Keeps drinks cold for 48 hours. #stayhydrated",
    );
    setError(null);
    setFileNotice(null);
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setFileNotice(null);

    // Validate extension
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError("Unsupported file type. Only .docx files are accepted.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Validate size (4 MB limit)
    if (file.size > 4 * 1024 * 1024) {
      setError("File too large. Maximum file size is 4 MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await apiFetch<{ text: string; characters: number }>(
        "/api/contents/extract",
        {
          method: "POST",
          body: formData,
        },
      );

      setBody(res.text);
      setFileNotice(
        `Successfully extracted text from ${file.name} (${res.characters} characters). You can edit it below before saving.`,
      );
    } catch (err) {
      console.error("DOCX extraction error:", err);
      if (err instanceof ApiError) {
        if (err.status === 413) {
          setError("File too large. Maximum upload limit is 4 MB.");
        } else if (err.status === 415) {
          setError("Unsupported file type. Please upload a .docx file.");
        } else {
          setError(`Extraction failed: ${err.message}`);
        }
      } else {
        setError("Failed to extract text from document.");
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !purpose.trim() || !audience.trim() || !body.trim()) {
      setError("Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch<{
        content: { id: string };
        revision: { id: string };
      }>("/api/contents", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          channel,
          audience: audience.trim(),
          purpose: purpose.trim(),
          body,
        }),
      });

      navigate(`/content/${res.content.id}`);
    } catch (err) {
      console.error("Content creation error:", err);
      if (err instanceof ApiError) {
        setError(`Failed to save content: ${err.message}`);
      } else {
        setError("Failed to save content. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Link to="/content" className="hover:text-slate-900 transition-colors">
              ← Back to Content
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Submit New Content
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Provide the purpose, target audience, and draft copy for review.
          </p>
        </div>

        <button
          type="button"
          onClick={handleUseSample}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer border border-slate-200"
        >
          <svg
            className="w-3.5 h-3.5 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          Use sample caption
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {fileNotice && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {fileNotice}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm space-y-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="sm:col-span-2 space-y-1.5">
            <label
              htmlFor="title"
              className="block text-sm font-semibold text-slate-900"
            >
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="title"
              type="text"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Instagram caption: Flow launch"
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
            <span className="text-xs text-slate-400 block text-right">
              {title.length}/120
            </span>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="channel"
              className="block text-sm font-semibold text-slate-900"
            >
              Channel <span className="text-red-500">*</span>
            </label>
            <select
              id="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white"
            >
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="audience"
            className="block text-sm font-semibold text-slate-900"
          >
            Audience <span className="text-red-500">*</span>
          </label>
          <input
            id="audience"
            type="text"
            required
            maxLength={200}
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. Urban buyers aged 22 to 35"
            className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
          <span className="text-xs text-slate-400 block text-right">
            {audience.length}/200
          </span>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="purpose"
            className="block text-sm font-semibold text-slate-900"
          >
            Purpose <span className="text-red-500">*</span>
          </label>
          <textarea
            id="purpose"
            required
            rows={2}
            maxLength={300}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Highlight sustainability and lightness of the new bottle"
            className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              What should this piece achieve? Vouch keeps suggested fixes true to this purpose.
            </p>
            <span className="text-xs text-slate-400">{purpose.length}/300</span>
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <label
              htmlFor="body"
              className="block text-sm font-semibold text-slate-900"
            >
              Body Copy <span className="text-red-500">*</span>
            </label>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 transition-colors cursor-pointer disabled:opacity-50"
              >
                <svg
                  className="w-3.5 h-3.5 text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                {uploading ? "Extracting text…" : "Upload .docx"}
              </button>
            </div>
          </div>

          <textarea
            id="body"
            required
            rows={7}
            maxLength={20000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type, paste marketing copy, or upload a .docx document above…"
            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent font-mono"
          />

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Supports direct text editing or plain text from extracted DOCX.</span>
            <span>{body.length.toLocaleString()} / 20,000 characters</span>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
          <Link
            to="/content"
            className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {submitting ? "Saving…" : "Save content"}
          </button>
        </div>
      </form>
    </div>
  );
}
