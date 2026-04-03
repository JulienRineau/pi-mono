---
name: review-security
description: Security review checklist — OWASP top 10, input validation, auth, secrets, injection
---

# Security Review Checklist

## Evaluate

- [ ] **Input validation**: Is all external input validated and sanitized? SQL, command, path injection?
- [ ] **Authentication**: Are auth checks present where needed? No bypasses?
- [ ] **Authorization**: Are permissions checked? Can users access only what they should?
- [ ] **Secrets management**: No hardcoded secrets, API keys, passwords in code or logs?
- [ ] **Data exposure**: Are sensitive fields excluded from logs, error messages, API responses?
- [ ] **CSRF/XSS**: Are web endpoints protected against cross-site attacks?
- [ ] **Dependency security**: Are new dependencies from trusted sources? Known vulnerabilities?
- [ ] **File operations**: Are file paths validated? No path traversal? Safe temp file handling?
- [ ] **Error handling**: Do error messages avoid leaking internal details?
- [ ] **Rate limiting**: Are public endpoints protected against abuse?

## Critical Indicators

Flag as Critical:
- Hardcoded secrets or credentials
- SQL/command/path injection vulnerability
- Missing authentication on sensitive endpoints
- Sensitive data in logs or error responses
- Unsafe deserialization of untrusted input

## When Reviewing Plans

Focus on: whether security requirements are addressed in the design, if auth/authz is planned for new endpoints, if the plan considers the threat model.

## When Reviewing Implementation

Focus on: actual input handling code, grep for hardcoded strings that look like secrets, check new dependencies, verify auth middleware is applied.
