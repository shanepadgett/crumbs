# Questionnaire Extension

Command-driven Q&A flow for Pi.

This package exposes one extension command:

- `/qna` extracts answerable questions from last assistant message, opens multiple-choice UI, then sends completed answers back into chat as extension message

## Behavior

- user invokes `/qna`
- extractor sees full branch context for disambiguation
- extractor may only draw questions from last assistant message
- questionnaire UI shows options plus optional recommendation and reason
- completed answers are sent back to agent as structured custom message

## Guardrails

- no tool is exposed to agent
- duplicate question ids are rejected
- questions with no selectable options require custom input to stay enabled
- extraction is capped to small questionnaire size
