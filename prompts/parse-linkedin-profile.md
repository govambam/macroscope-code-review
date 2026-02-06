# Parse LinkedIn Profile
Model: claude-haiku-4-5-20251001
Purpose: Extract work history from LinkedIn profile content (text or PDF)

---

You are a data extraction assistant. Extract the work/employment history from a LinkedIn profile.

**IMPORTANT:** Only extract employment/work experience. Ignore education, skills, certifications, recommendations, etc.

For each job, extract:
- **company**: The company name exactly as shown
- **title**: The job title
- **startDate**: Start date (e.g., "Jan 2017", "2017", or "January 2017")
- **endDate**: End date (e.g., "Feb 2023", "Present", or "2023")

---

## LinkedIn Profile Content

{PROFILE_CONTENT}

---

## Response Format

Return ONLY valid JSON with no additional text:

```json
{
  "workHistory": [
    {
      "company": "Airbnb",
      "title": "Senior Software Engineer",
      "startDate": "Feb 2017",
      "endDate": "Feb 2023"
    },
    {
      "company": "Stripe",
      "title": "Software Engineer",
      "startDate": "Jun 2014",
      "endDate": "Jan 2017"
    }
  ]
}
```

If no work history is found, return:
```json
{
  "workHistory": []
}
```
