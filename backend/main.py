import json
import logging
import os
import re
import time
from collections import defaultdict, deque
from typing import Deque, Dict, List

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

import google.generativeai as genai

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("resume_reviewer")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise ValueError("GOOGLE_API_KEY is not set in the .env file")

genai.configure(api_key=GOOGLE_API_KEY)

DEFAULT_MODELS = [
    "models/gemini-1.5-flash-latest",
    "models/gemini-1.5-flash",
    "models/gemini-1.5-pro-latest",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
    "gemini-1.5-pro-latest",
]
ENV_MODELS = [item.strip() for item in os.getenv("GEMINI_MODEL", "").split(",") if item.strip()]
def fetch_available_models() -> List[str]:
    try:
        models = [
            model.name
            for model in genai.list_models()
            if "generateContent" in model.supported_generation_methods
        ]
        return models
    except Exception as exc:
        logger.warning("Failed to fetch Gemini models: %s", exc)
        return []


MODEL_CANDIDATES = ENV_MODELS or fetch_available_models() or DEFAULT_MODELS
ACTIVE_MODEL_NAME = None

app = FastAPI(title="Resume Reviewer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple in-memory rate limiting by IP.
RATE_LIMIT = 30
RATE_WINDOW_SECONDS = 60
request_log: Dict[str, Deque[float]] = defaultdict(deque)


def enforce_rate_limit(client_ip: str) -> None:
    now = time.time()
    queue = request_log[client_ip]
    while queue and now - queue[0] > RATE_WINDOW_SECONDS:
        queue.popleft()
    if len(queue) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again soon.")
    queue.append(now)


class ReviewRequest(BaseModel):
    resume: str = Field("", max_length=4000)
    job_description: str = Field("", max_length=6000)
    role_title: str = Field("", max_length=120)

    @field_validator("resume", "job_description", "role_title")
    def not_empty(cls, value: str) -> str:
        return value or ""


class SectionFeedback(BaseModel):
    strengths: List[str]
    weaknesses: List[str]
    rewrites: List[str]
    keywords: List[str]


class ReviewResponse(BaseModel):
    overview: str
    match_level: str
    sections: Dict[str, SectionFeedback]
    top_fixes: List[str]
    jd_keywords: List[str] = []
    insertion_guidance: List[str] = []
    missing_info: List[str] = []
    resume_outline: List[str] = []


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model": ACTIVE_MODEL_NAME or MODEL_CANDIDATES[0],
        "candidates": MODEL_CANDIDATES,
    }


@app.get("/models")
async def list_models():
    return {"models": fetch_available_models() or MODEL_CANDIDATES}


def extract_json(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if match:
        return match.group(0)
    return cleaned


def coerce_list(value: object) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [line.strip("- ").strip() for line in value.splitlines() if line.strip()]
    return []


def normalize_section(payload: dict, key: str) -> SectionFeedback:
    section = payload.get("sections", {}).get(key, {}) if isinstance(payload.get("sections"), dict) else {}
    if not isinstance(section, dict):
        section = {}
    return SectionFeedback(
        strengths=coerce_list(section.get("strengths", [])),
        weaknesses=coerce_list(section.get("weaknesses", [])),
        rewrites=coerce_list(section.get("rewrites", [])),
        keywords=coerce_list(section.get("keywords", [])),
    )


def normalize_response(payload: dict, require_content: bool = True) -> ReviewResponse:
    overview = str(payload.get("overview", "")).strip()
    match_level = str(payload.get("match_level", "")).strip()
    top_fixes = coerce_list(payload.get("top_fixes", []))

    sections = {
        "profile_summary": normalize_section(payload, "profile_summary"),
        "experience": normalize_section(payload, "experience"),
        "projects": normalize_section(payload, "projects"),
        "skills": normalize_section(payload, "skills"),
        "education": normalize_section(payload, "education"),
    }

    jd_keywords = coerce_list(payload.get("jd_keywords", []))
    insertion_guidance = coerce_list(payload.get("insertion_guidance", []))
    missing_info = coerce_list(payload.get("missing_info", []))
    resume_outline = coerce_list(payload.get("resume_outline", []))

    if require_content and (not overview or not match_level or not top_fixes):
        raise ValueError("Missing required fields in model output")

    return ReviewResponse(
        overview=overview,
        match_level=match_level,
        sections=sections,
        top_fixes=top_fixes[:5],
        jd_keywords=jd_keywords,
        insertion_guidance=insertion_guidance,
        missing_info=missing_info,
        resume_outline=resume_outline,
    )


async def call_gemini_with_retry(prompt: str, retries: int = 2, require_content: bool = True) -> ReviewResponse:
    global ACTIVE_MODEL_NAME
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        for model_name in MODEL_CANDIDATES:
            try:
                response = genai.GenerativeModel(model_name).generate_content(prompt)
                raw_text = response.text or ""
                extracted = extract_json(raw_text)
                payload = json.loads(extracted)
                ACTIVE_MODEL_NAME = model_name
                return normalize_response(payload, require_content=require_content)
            except Exception as exc:
                last_error = exc
                message = str(exc)
                if "not found" in message or "not supported" in message:
                    logger.warning("Gemini model unavailable: %s", message)
                    continue
                logger.warning("Gemini parsing failed (%s/%s): %s", attempt + 1, retries + 1, exc)
        if attempt == retries:
            detail = (
                "No available Gemini model found. "
                "Set GEMINI_MODEL in the .env file."
                if last_error and ("not found" in str(last_error) or "not supported" in str(last_error))
                else "AI response could not be parsed. Please try again."
            )
            raise HTTPException(status_code=500, detail=detail)
        prompt += (
            "\n\nReturn ONLY valid JSON with keys overview, match_level, sections, top_fixes, "
            "jd_keywords, insertion_guidance, missing_info, resume_outline. "
            "Do not wrap in code fences."
        )


@app.post("/review", response_model=ReviewResponse)
async def review_resume(data: ReviewRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(client_ip)

    resume_text = data.resume.strip()
    job_description = data.job_description.strip()
    role_title = data.role_title.strip()

    if not resume_text and not role_title:
        raise HTTPException(status_code=400, detail="Provide a resume or a target role title.")

    if not resume_text:
        prompt = f"""
You are an expert Resume Reviewer for software and tech roles.
The user has only provided a role title and no resume.
Provide a concise outline they can fill in and request missing info.

Role Title: {role_title}
Job Description: {job_description or "Not provided"}

Return JSON ONLY with keys:
overview: 1-2 sentences explaining you need a resume to review.
match_level: Low
sections: include keys profile_summary, experience, projects, skills, education. Each section should have arrays for strengths, weaknesses, rewrites, keywords (empty arrays are OK).
top_fixes: 3-5 bullets on what to gather next.
jd_keywords: 5-10 important keywords if JD provided, else empty array.
insertion_guidance: where to place those keywords if a resume were provided.
missing_info: list of details you need from the user.
resume_outline: bullet outline for a tech resume they can fill in.
"""
        return await call_gemini_with_retry(prompt, require_content=False)

    prompt = f"""
You are an expert Resume Reviewer for software and tech roles.
Analyze the resume (and job description if provided) and give clear, practical, prioritized feedback.

Goals:
- Evaluate match to target role.
- Improve clarity, impact, and brevity.
- Optimize for ATS.
- Suggest concrete rewrites (do not invent experience).

Instructions:
- Start with a short overview (1-2 sentences) and match level (Low/Medium/High).
- Then provide section-by-section feedback with headings: Profile / Summary, Experience, Projects, Skills, Education / Certifications.
- For each section: strengths, weaknesses, example rewrites, keywords for ATS.
- If resume is short/junior, suggest projects/coursework to add.
- If JD provided: list top 5-10 skills/keywords and show how to insert them.

Role Title: {role_title or "Not provided"}
Job Description: {job_description or "Not provided"}
Resume: {resume_text}

Return JSON ONLY with keys:
overview: brief overview (2-3 sentences).
match_level: Low/Medium/High.
sections: object with keys profile_summary, experience, projects, skills, education.
Each section has arrays: strengths, weaknesses, rewrites, keywords.
top_fixes: Top 5 changes to make next, ordered by impact.
jd_keywords: list of keywords from the JD (empty if no JD).
insertion_guidance: bullets showing where/how to insert JD keywords.
missing_info: details to request if resume lacks specifics.
resume_outline: empty array unless resume is missing.
"""

    return await call_gemini_with_retry(prompt)


@app.post("/tailor", response_model=ReviewResponse)
async def tailor_alias(data: ReviewRequest, request: Request):
    return await review_resume(data, request)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
