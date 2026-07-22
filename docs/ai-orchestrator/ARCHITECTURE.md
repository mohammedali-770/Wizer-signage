# AI Development Orchestrator

## Purpose

Automate the loop between product requirements, Claude Code implementation, CI validation, and OpenAI review without allowing autonomous production deployment or direct writes to the default branch.

## Roles

- **Human owner:** submits features, approves sensitive decisions, and performs the final merge.
- **OpenAI planner/reviewer:** converts requirements into executable tasks and acceptance criteria, reviews diffs and CI evidence, and returns a structured decision.
- **Claude Code executor:** implements only the assigned task on an isolated branch, runs the required validation commands, and opens or updates a draft pull request.
- **GitHub:** source of truth for requirements, commits, CI evidence, review history, and approvals.

## State machine

`RECEIVED -> PLANNED -> IMPLEMENTING -> VALIDATING -> REVIEWING`

Review outcomes:

- `APPROVED`: add `ai-approved`; keep the PR unmerged for human approval.
- `CHANGES_REQUIRED`: create a bounded corrective instruction and return to `IMPLEMENTING`.
- `HUMAN_DECISION_REQUIRED`: stop the loop and explain the exact decision needed.
- `FAILED`: stop after the configured retry or cost limit.

## Mandatory safety controls

1. Never push to the default branch.
2. Never merge a pull request automatically.
3. Never deploy to production.
4. Never run destructive database commands.
5. Database migrations, authentication changes, payment changes, secret handling, infrastructure changes, and permission changes require explicit human approval.
6. Maximum automated correction cycles: 3.
7. Maximum Claude Code turns per cycle: 12.
8. One active orchestrator run per issue and repository.
9. All model outputs used for control flow must conform to a strict JSON schema.
10. Any ambiguous requirement that could cause data loss, billing impact, security impact, or user-visible behavior changes must stop for human review.

## Branch and PR convention

- Task branch: `ai/issue-<number>-<slug>`
- Draft PR title: `feat(ai): <issue title>`
- Base branch: repository default branch captured when the run starts
- The executor may update only its own task branch.

## Required evidence from Claude Code

Claude must return:

- implementation summary;
- changed files;
- commands executed;
- lint, typecheck, test, and build results;
- migrations or configuration changes;
- known risks and unresolved items;
- final commit SHA;
- pull request number.

Claims without command output or GitHub evidence are not accepted as proof.

## OpenAI review contract

The reviewer must return a JSON object matching this shape:

```json
{
  "status": "approved | changes_required | human_decision_required | failed",
  "summary": "string",
  "score": 0,
  "blocking_issues": [
    {
      "title": "string",
      "evidence": "string",
      "required_fix": "string",
      "files": ["path/to/file"]
    }
  ],
  "non_blocking_issues": [],
  "corrective_prompt": "string or empty",
  "requires_human_approval": false
}
```

Approval is permitted only when:

- all acceptance criteria are demonstrably satisfied;
- required CI checks pass;
- no unresolved blocking issue exists;
- no prohibited action occurred;
- the diff is limited to the requested scope.

## Initial implementation phases

### Phase 1 — GitHub-native pilot

- structured feature issue template;
- dispatcher workflow;
- Claude Code executor workflow;
- CI evidence collection;
- OpenAI review workflow;
- labels and bounded retry state;
- draft PR only.

### Phase 2 — Standalone control plane

- Next.js dashboard;
- Supabase run history, budgets, and audit log;
- GitHub App with least-privilege permissions;
- webhook-based event processing;
- project policies and per-repository commands.

### Phase 3 — Production hardening

- encrypted secret management;
- model cost budgets and rate limiting;
- idempotency and concurrency controls;
- signed webhook verification;
- observability, alerts, and retention policy;
- organization-wide reusable workflows.

## Required secrets for the pilot

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

Use repository or organization Actions secrets. Never place keys in source code, issue bodies, comments, artifacts, or workflow logs.
