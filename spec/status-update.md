# Status update start time

The status-update skill resolves a requested start date and time to a UTC cutoff
before collecting GitHub activity. A zone-less input uses the local named time
zone's rules at the requested date, including daylight saving, rather than the
current numeric UTC offset. A date without a time means midnight. An explicit
offset takes precedence over the local time zone.

The documented GNU `date` commands must produce these cutoffs when the local
zone is `America/New_York`:

| Input | UTC cutoff |
| --- | --- |
| `2026-01-15 00:00` | `2026-01-15T05:00:00Z` |
| `2026-07-15 00:00` | `2026-07-15T04:00:00Z` |
| `2026-01-15` | `2026-01-15T05:00:00Z` |
| `2026-01-15T00:00:00+02:00` | `2026-01-14T22:00:00Z` |

Integration coverage in `tests/status-update.test.ts` executes the skill's
documented commands without making GitHub or Slack requests.
