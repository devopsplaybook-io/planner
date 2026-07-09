# LLM Recommendations

## Overview

The dashboard displays AI-generated recommendations for each user, providing insights on task management performance, upcoming priorities, and Kanban best practices.

## Functional Requirements

- [x] The dashboard displays personalized recommendations for the authenticated user.
- [x] Recommendations are calculated per user by the LLM:
  - [x] The LLM receives as input all tasks assigned to the user, plus unassigned tasks that are not in a "Done" state.
  - [x] Recommendations are generated on a configurable schedule (cron expression defined in configuration).
  - [x] The recommendation feature can be enabled or disabled via configuration.
  - [x] The dashboard displays only the most recent recommendation for each user.
  - [x] Each user can only see their own recommendations.
  - [x] When the recommendation feature is disabled, the dashboard hides the recommendation section and the regenerate button.
  - [x] Recommendations are cached on disk (one JSON file per user), not stored in the database.
  - [x] Users can click a button to manually re-generate their recommendations.
- [x] Each recommendation includes:
  - [x] A performance summary: how the user performed on past tasks (completion delays, throughput).
  - [x] The suggested next task to work on, with rationale.
  - [x] Kanban health advice: guidance on maintaining a healthy backlog (due date hygiene, WIP limits, missing details, best practices).
  - [x] Clickable links to referenced tasks so the user can navigate directly.

## Implementation Status

`[x]` = Done &ensp; `[~]` = Partial &ensp; `[ ]` = Not Started &ensp; | &ensp; Last spec review:
