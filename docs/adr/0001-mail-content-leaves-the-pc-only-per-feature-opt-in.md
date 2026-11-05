# Mail content goes to Claude only through a per-feature opt-in

WinMail is local-first: the user's mail lives on their PC. A saved Claude API key alone therefore allows no message content (subjects, bodies, attachments, addresses) to leave the PC. Each feature that would send content has its own Content opt-in in Settings, says what it sends, and the UI shows a visible marker whenever content is sent. Features that send only the user's own words (AI search sends the question, never mail) need no opt-in.

## Considered Options

- **No mail to the cloud, ever** (local heuristics or a local model only): rejected for now because it rules out most AI features. The opt-in is designed so a local model can later take Claude's place behind the same switch.
- **Anything goes once a key is saved**: rejected. It contradicts the local-first promise, and a user adding a key for one feature would silently allow every other one.

## Consequences

- The existing Summarise and Suggest a reply send message content and need their own Content opt-ins to comply.
