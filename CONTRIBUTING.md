# Contributing to Agent Cassette

We welcome contributions! This project aligns with **FlowFuse** and **Node-RED** engineering standards.

## 1. Developer Certificate of Origin (DCO)

All contributions must be signed off to certify that you have the right to submit the code.
Please use the `-s` flag when committing:
`git commit -s -m "feat: add robust node-red extraction"`

## 2. Engineering Standards

- **TypeScript:** We use strict typing. Avoid `any` where possible.
- **Tests:** All new features must include a deterministic test case (record/replay).
- **Linting:** Run `npm run lint` before submitting.

## 3. Frontend & Design (Future Roadmap)

If this project expands to include a UI:

- We align with the **FlowFuse Design System** (Vue.js + Tailwind).
- Current CLI output follows standard "System/Metric" log formatting.
