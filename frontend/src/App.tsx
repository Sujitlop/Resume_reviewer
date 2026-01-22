import { useEffect, useMemo, useState } from "react";

const MAX_RESUME = 4000;
const MAX_JD = 6000;
const MAX_ROLE = 120;
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

type SectionFeedback = {
  strengths: string[];
  weaknesses: string[];
  rewrites: string[];
  keywords: string[];
};

type ReviewResponse = {
  overview: string;
  match_level: string;
  sections: Record<string, SectionFeedback>;
  top_fixes: string[];
  jd_keywords?: string[];
  insertion_guidance?: string[];
  missing_info?: string[];
  resume_outline?: string[];
};

export default function App() {
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<null | string>(null);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("resume-tailor-dark");
    if (stored) {
      setDarkMode(stored === "true");
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("resume-tailor-dark", String(darkMode));
  }, [darkMode]);

  const hasResults = useMemo(() => Boolean(review), [review]);

  const validateInputs = () => {
    if (!resume.trim() && !roleTitle.trim()) {
      return "Provide at least a resume or a role title.";
    }
    if (resume.length > MAX_RESUME) {
      return `Resume must be under ${MAX_RESUME} characters.`;
    }
    if (jobDescription.length > MAX_JD) {
      return `Job description must be under ${MAX_JD} characters.`;
    }
    if (roleTitle.length > MAX_ROLE) {
      return `Role title must be under ${MAX_ROLE} characters.`;
    }
    return "";
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateInputs();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          resume,
          job_description: jobDescription,
          role_title: roleTitle
        })
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || "Failed to tailor resume.");
      }

      const data: ReviewResponse = await response.json();
      setReview(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (section: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(section);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Clipboard access failed. Please copy manually.");
    }
  };

  const sectionLabels: Record<string, string> = {
    profile_summary: "Profile / Summary",
    experience: "Experience",
    projects: "Projects",
    skills: "Skills",
    education: "Education / Certifications"
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-10 flex flex-col items-center gap-4 text-center">
          <div className="flex w-full items-center justify-between">
            <div className="text-left">
              <p className="text-sm uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                Resume & JD Tailor
              </p>
              <h1 className="text-3xl font-semibold sm:text-4xl">Resume Tailor AI</h1>
            </div>
            <button
              type="button"
              onClick={() => setDarkMode((prev) => !prev)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {darkMode ? "Light mode" : "Dark mode"}
            </button>
          </div>
          <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Paste your resume and (optionally) a job description to get practical, prioritized reviewer
            feedback tailored to your target role.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-6">
              <label className="mb-2 block text-sm font-semibold">Role Title (optional)</label>
              <input
                type="text"
                value={roleTitle}
                onChange={(event) => setRoleTitle(event.target.value)}
                placeholder="Senior Product Manager"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {roleTitle.length}/{MAX_ROLE}
              </p>
            </div>

            <div className="mb-6">
              <label className="mb-2 block text-sm font-semibold">Resume</label>
              <textarea
                value={resume}
                onChange={(event) => setResume(event.target.value)}
                rows={10}
                placeholder="Paste your resume content here..."
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {resume.length}/{MAX_RESUME}
              </p>
            </div>

            <div className="mb-6">
              <label className="mb-2 block text-sm font-semibold">Job Description (optional)</label>
              <textarea
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                rows={10}
                placeholder="Paste the job description here..."
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {jobDescription.length}/{MAX_JD}
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              {loading && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              Review My Resume
            </button>
          </form>

          <section className="space-y-6">
            {!loading && !hasResults && (
              <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                <p className="text-lg font-medium">Your tailored content will appear here.</p>
                <p className="text-sm">Complete the form and click “Review My Resume”.</p>
              </div>
            )}

            {loading && (
              <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white p-8 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                <span className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-300/40 border-t-indigo-500" />
                <p className="text-sm font-medium">Gemini is reviewing your resume...</p>
              </div>
            )}

            {!loading && hasResults && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold">Overall Impression</h2>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {review?.overview}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-200">
                      Match: {review?.match_level || "Unknown"}
                    </span>
                  </div>
                </div>

                {review?.resume_outline && review.resume_outline.length > 0 && (
                  <ReviewListCard
                    title="Resume Outline to Fill In"
                    items={review.resume_outline}
                    copyKey="resume-outline"
                    copied={copied}
                    onCopy={handleCopy}
                  />
                )}

                {review?.missing_info && review.missing_info.length > 0 && (
                  <ReviewListCard
                    title="Info Needed From You"
                    items={review.missing_info}
                    copyKey="missing-info"
                    copied={copied}
                    onCopy={handleCopy}
                  />
                )}

                {review?.sections &&
                  Object.entries(review.sections).map(([key, value]) => (
                    <SectionCard
                      key={key}
                      title={sectionLabels[key] ?? key}
                      sectionKey={key}
                      data={value}
                      copied={copied}
                      onCopy={handleCopy}
                    />
                  ))}

                {review?.jd_keywords && review.jd_keywords.length > 0 && (
                  <ReviewListCard
                    title="Top JD Keywords"
                    items={review.jd_keywords}
                    copyKey="jd-keywords"
                    copied={copied}
                    onCopy={handleCopy}
                  />
                )}

                {review?.insertion_guidance && review.insertion_guidance.length > 0 && (
                  <ReviewListCard
                    title="Where to Insert JD Keywords"
                    items={review.insertion_guidance}
                    copyKey="insertion-guidance"
                    copied={copied}
                    onCopy={handleCopy}
                  />
                )}

                {review?.top_fixes && review.top_fixes.length > 0 && (
                  <ReviewListCard
                    title="Top 5 Changes to Make Next"
                    items={review.top_fixes}
                    copyKey="top-fixes"
                    copied={copied}
                    onCopy={handleCopy}
                  />
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

type SectionCardProps = {
  title: string;
  sectionKey: string;
  data: SectionFeedback;
  copied: string | null;
  onCopy: (section: string, text: string) => void;
};

function SectionCard({ title, sectionKey, data, copied, onCopy }: SectionCardProps) {
  const buildText = () =>
    [
      `${title}`,
      "",
      "What to keep:",
      ...data.strengths.map((item) => `- ${item}`),
      "",
      "What to improve:",
      ...data.weaknesses.map((item) => `- ${item}`),
      "",
      "Example rewrites:",
      ...data.rewrites.map((item) => `- ${item}`),
      "",
      "ATS keywords:",
      ...data.keywords.map((item) => `- ${item}`)
    ].join("\n");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={() => onCopy(sectionKey, buildText())}
          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 dark:border-slate-700 dark:text-slate-300"
        >
          {copied === sectionKey ? "Copied!" : "Copy"}
        </button>
      </div>
      <SectionGroup title="What to keep" items={data.strengths} />
      <SectionGroup title="What to improve" items={data.weaknesses} />
      <SectionGroup title="Example rewrites" items={data.rewrites} />
      <SectionGroup title="ATS keywords" items={data.keywords} />
    </div>
  );
}

type SectionGroupProps = {
  title: string;
  items: string[];
};

function SectionGroup({ title, items }: SectionGroupProps) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No notes provided.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-200">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ReviewListCardProps = {
  title: string;
  items: string[];
  copyKey: string;
  copied: string | null;
  onCopy: (section: string, text: string) => void;
};

function ReviewListCard({ title, items, copyKey, copied, onCopy }: ReviewListCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={() => onCopy(copyKey, items.map((item) => `- ${item}`).join("\n"))}
          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 dark:border-slate-700 dark:text-slate-300"
        >
          {copied === copyKey ? "Copied!" : "Copy"}
        </button>
      </div>
      <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
